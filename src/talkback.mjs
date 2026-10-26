// Authenticated return-audio path for the existing Home Assistant HomeKit Bridge.
// AAC-LC 16 kHz mono ADTS arrives through TLS; the SDK manages P2P acknowledgements.
import { streamClientFor, isSupersededStreamClient } from "../streams.mjs";

function waitForDrain(writable, response, talk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      writable.off("drain", drained);
      writable.off("error", failed);
      response.off("close", closed);
      talk.off("stop", stopped);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const failed = (error) => {
      cleanup();
      reject(error);
    };
    const closed = () => failed(new Error("talkback connection closed"));
    const stopped = () => failed(new Error("talkback session stopped"));
    writable.once("drain", drained);
    writable.once("error", failed);
    response.once("close", closed);
    talk.once("stop", stopped);
  });
}

async function finishInput(talk, writable) {
  if (!talk || !writable) return;
  // Let the last speech frame reach the speaker rather than discard it on EOF.
  await Promise.race([
    new Promise((resolve) => {
      talk.once("finished", resolve);
      talk.once("stop", resolve);
      writable.end();
    }),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

/**
 * The response is flushed before awaiting media, so aiohttp can upload its
 * streaming request. A new SDK talkback lease begins on the first audio bytes;
 * the SDK's idle shutdown can be followed by a fresh lease after a long pause.
 */
export async function serveTalkback({ ctx, req, res, serial, respondJson }) {
  if (ctx.streamBackoffMs?.(serial) > 0) {
    return respondJson(res, 503, { error: "stream backing off" });
  }
  let active = true;
  let talk = null;
  let writable = null;
  let stopped = false;
  const onGone = () => {
    active = false;
    void talk?.stop();
  };
  req.once("aborted", onGone);
  res.once("close", onGone);

  try {
    const client = await (ctx.streamClientFor ?? streamClientFor)(serial, ctx.cfg);
    if (!active) return;
    const device = await client.getDevice(serial);
    const camera = device.camera?.();
    if (!camera?.talkback) {
      return respondJson(res, 404, { error: "two-way audio not available" });
    }
    if (!active) return;

    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    res.flushHeaders?.();

    for await (const chunk of req) {
      if (!active) break;
      if (!chunk.length) continue;
      if (stopped || !talk) {
        if (talk) await talk.stop();
        talk = await camera.talkback();
        stopped = false;
        talk.on("stop", () => {
          stopped = true;
        });
        talk.on("error", (error) => {
          ctx.eventLog?.(`/talkback ${serial} media error: ${String(error?.message ?? error)}`);
          res.destroy();
        });
        writable = talk.writable();
        writable.on("error", () => res.destroy());
      }
      if (!writable.write(chunk)) await waitForDrain(writable, res, talk);
    }

    if (active && !res.destroyed) {
      await finishInput(talk, writable);
      res.end();
    }
  } catch (error) {
    if (active) {
      const status = isSupersededStreamClient(error) ? 503 : 502;
      if (res.headersSent) res.destroy();
      else respondJson(res, status, { error: "talkback media unavailable" });
      ctx.eventLog?.(`/talkback ${serial} failed: ${String(error?.message ?? error)}`);
    }
  } finally {
    active = false;
    req.off("aborted", onGone);
    res.off("close", onGone);
    if (talk) await talk.stop();
  }
}
