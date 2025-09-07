const regex = /\/\*@--BUNDLE--(.*?)--@\*\//g;

const matches = "/*@--BUNDLE--plants--@*/".matchAll(
  regex,
)

Array.from(matches);

/**
 * @param {string} str 
 * @param {RegExp} regex 
 * @param {(match: RegExpExecArray)=>string} asyncFn 
 */
export const asyncReplaceAll = async (str: string, regex: RegExp, asyncFn: (match: RegExpExecArray)=>string) => {
  const matches = Array.from(str.matchAll(regex));
  const replacedChunks = await Promise.all(matches.map(async (match) => asyncFn(match)));
  let finalReplacedStr = "";
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const prevMatch = matches[i - 1] ?? null;
    const replacedChunk = replacedChunks[i];
    finalReplacedStr += str.slice(prevMatch ? prevMatch.index + prevMatch[0].length : 0, match.index) + replacedChunk;
  }
  return finalReplacedStr;
};

const result = await asyncReplaceAll("/*@--BUNDLE--plants--@*/\n/*@--BUNDLE--default--@*/", regex, async (match)=>{
  return match[1];
});