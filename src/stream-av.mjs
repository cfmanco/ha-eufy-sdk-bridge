// The HomeKit media route: one SDK fragment consumer per authorised HTTP request.
// Authentication and route validation happen in http-routes.mjs before this handler.
import { onBatteryPower } from "./power.mjs";
import { isSupersededStreamClient } from "../streams.mjs";

async function writeChunk(res, data, disconnected) {
  if (!data?.length) return true;
  if (disconnected() || res.destroyed) return false;
  if (res.write(data)) return true;

  // Respect HTTP backpressure; a stalled client must not buffer unbounded media.
  await new Promise((resolve) => {
    const resume = () => {
      res.off("drain", resume);
      res.off("close", resume);
      resolve();
    };
    res.once("drain", resume);
    res.once("close", resume);
  });
  return !disconnected() && !res.destroyed;
}

/**
 * Stream SDK CMAF fragments to HomeKit's FFmpeg input without changing the
 * existing /stream raw-video path. Every exit path releases the SDK consumer.
 */
export async function serveMuxedStream({ req, res, serial, ctx, openStreamClient, respondJson }) {
  if (ctx.streamBackoffMs?.(serial) > 0) {
    return respondJson(res, 503, { error: "stream backing off" });
  }

  let gone = false;
  let recording;
  const onGone = () => {
    gone = true;
    recording?.stop();
  };
  res.once("close", onGone);
  req.once?.("aborted", onGone);

  try {
    const client = await openStreamClient(serial, ctx.cfg);
    if (gone) return;
    const device = await client.getDevice(serial);
    if (gone) return;

    const camera = device.camera?.();
    if (!camera?.recordFragments) {
      return respondJson(res, 404, { error: "muxed live media unavailable" });
    }

    const description = device.describe?.();
    const powered =
      description && !onBatteryPower(description.model, description.capabilities)
        ? "wired"
        : "battery";
    recording = camera.recordFragments({ fragmentSeconds: 1, powered });
    recording.on("budget", (notice) => {
      if (!gone) notice.extend();
    });
    if (gone) return;

    res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" });
    for await (const fragment of recording) {
      if (gone || !(await writeChunk(res, fragment.init, () => gone))) break;
      if (!(await writeChunk(res, fragment.data, () => gone))) break;
    }
    if (!gone && !res.destroyed) res.end();
  } catch (error) {
    if (gone) return;
    if (isSupersededStreamClient(error)) {
      return respondJson(res, 503, { error: "media session replaced" });
    }
    ctx.noteStreamFailure?.(serial, String(error?.message ?? error));
    if (res.headersSent) res.destroy();
    else respondJson(res, 502, { error: String(error?.message ?? error) });
  } finally {
    recording?.stop();
    res.off("close", onGone);
    req.off?.("aborted", onGone);
  }
}
