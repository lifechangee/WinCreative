/**
 * Non-document files that can be dropped into the Gallery's Import: brushes, brush sets, fonts, palettes.
 * Feature modules register what they can consume; the Gallery routes by file extension before trying to open the file
 * as artwork.
 */
export interface ResourceImporter {
  exts: string[]
  /** returns the message to toast */
  run(bytes: Uint8Array, fileName: string): Promise<string>
}

const list: ResourceImporter[] = []

export function registerResourceImporter(i: ResourceImporter): void {
  list.push(i)
}

const extOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export function findResourceImporter(fileName: string): ResourceImporter | undefined {
  const ext = extOf(fileName)
  return list.find((i) => i.exts.includes(ext))
}

/** Every extension the Import dialog should offer for resources. */
export const resourceExtensions = (): string[] => list.flatMap((i) => i.exts)

/** Run the importer that owns `fileName` (QA / scripting handle; the Gallery dialog uses findResourceImporter). */
;(globalThis as { brushwork_resourceImport?: unknown }).brushwork_resourceImport = {
  run: async (bytes: Uint8Array, fileName: string): Promise<string | null> => (await findResourceImporter(fileName)?.run(bytes, fileName)) ?? null,
  extensions: resourceExtensions
}
