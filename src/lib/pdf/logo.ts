// react-pdf's browser Image loader swallows fetch failures silently, leaving an empty
// bordered box. The stored logo URL is also baked with whatever origin was active at
// upload time, so it can point at a stale domain. Fetching it ourselves and inlining it
// as a data URI sidesteps both failure modes.
export async function toDataUri(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
