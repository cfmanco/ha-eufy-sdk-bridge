// A Readable consumer does not surface the SDK's battery budget event.
// Attach a second handle to the SAME SDK shared source; extending its budget
// keeps the feed running for as long as the HTTP viewer is connected.
export async function keepLiveUntilDisconnect(camera, isConnected, options) {
  if (typeof camera?.live !== "function") return () => {};
  const handle = await camera.live(options);
  const onBudget = (notice) => {
    if (isConnected() && typeof notice?.extend === "function") notice.extend();
  };
  handle.on("budget", onBudget);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    handle.off?.("budget", onBudget);
    handle.stop();
  };
}
