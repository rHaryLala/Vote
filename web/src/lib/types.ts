export type Choice = 'yes' | 'no' | 'blank'

export interface ElectionInfo {
  id: number
  title: string
  question: string
  candidate: { name: string; title: string | null; photo: string | null; bio: string | null; program: string[] }
  status: 'draft' | 'open' | 'closed'
  is_open: boolean
  opens_at: string
  closes_at: string
  results_published: boolean
  choices: Choice[]
}

export interface Tally {
  registered: number
  cast: number
  yes: number
  no: number
  blank: number
  expressed: number
  turnout_percent: number
  quorum_percent: number | null
  quorum_reached: boolean
  majority_reached: boolean
  accepted: boolean
}

export interface VoterInfo {
  email: string
  name?: string | null
  picture?: string | null
  has_voted: boolean
}
