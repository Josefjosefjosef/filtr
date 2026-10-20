export async function storeOp(store, method, ...args) {
  const fn = store[method];
  if (typeof fn !== "function") {
    throw new Error("store_method_missing:" + method);
  }
  const result = fn(...args);
  return result && typeof result.then === "function" ? await result : result;
}
