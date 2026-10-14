// Mirrors the server's accepted shapes so the form can recognise a repo while the user types.
export function parseRepoUrl(input: string): { owner: string; name: string; url: string } | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!m?.[1] || !m[2]) return null;
  return { owner: m[1], name: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}
