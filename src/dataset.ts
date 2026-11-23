import type { DocumentData, Edition, Mapping, Status, UnitSummary } from './documents.ts'

export interface Location { chunk: number; row: number }
export interface Dataset {
  documents: Record<Edition, Omit<DocumentData, 'units'> & { units: UnitSummary[] }>
  mappings: Mapping[]
  totals: Record<Status, number>
  chunkCount: number
  locations: Record<string, Location>
  changes: Location[]
  extraction: Record<Edition, { pages: number; review: boolean }>
}
