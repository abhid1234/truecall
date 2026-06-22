// Tokenize pretty-printed JSON into {text, cls} spans for safe colored rendering.
// Returns DATA, not markup — the caller renders each token as a textContent span,
// so there is no XSS surface even for user-edited contracts.
// cls ∈ { key, str, num, punct, plain }. Concatenating .text reproduces the input exactly.
export function highlightJson(value) {
  const src = JSON.stringify(value, null, 2);
  const tokens = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],])|(\s+)/g;
  let m, last = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) tokens.push({ text: src.slice(last, m.index), cls: "plain" });
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], cls: m[2] ? "key" : "str" });
      if (m[2]) tokens.push({ text: m[2], cls: "punct" });
    } else if (m[3] !== undefined) tokens.push({ text: m[3], cls: "num" });
    else if (m[4] !== undefined) tokens.push({ text: m[4], cls: "num" });
    else if (m[5] !== undefined) tokens.push({ text: m[5], cls: "punct" });
    else if (m[6] !== undefined) tokens.push({ text: m[6], cls: "plain" });
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ text: src.slice(last), cls: "plain" });
  return tokens;
}
