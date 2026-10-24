export type MarkdownImportPreview = { fileId: string; fileRevision: string; refused: string[]; sections: {
  libraryId: string; databaseBody: string; markdownBody: string; expectedRevision: string; sectionHash: string; differs: boolean;
}[] };
