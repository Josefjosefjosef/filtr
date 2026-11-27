export function navigationAbortShouldRetry(error) {
  const message = String(error && error.message ? error.message : error);
  return message.includes("ERR_ABORTED");
}
