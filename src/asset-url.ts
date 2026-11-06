// Resolve public files relative to the project URL, including GitHub Pages subpaths.
export function assetUrl(path:string){
  return path.startsWith('/')?`${import.meta.env.BASE_URL}${path.slice(1)}`:path;
}
