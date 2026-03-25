import type { Database } from '@/database.types'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

type BriefRow = Database['public']['Tables']['briefs']['Row']
type StoryRow = Database['public']['Tables']['stories']['Row']

export type LatestBriefBundle = {
  brief: BriefRow
  stories: StoryRow[]
}

export async function getLatestPublishedBriefWithStories(): Promise<LatestBriefBundle | null> {
  const supabase = createSupabaseServiceClient()

  const { data: brief, error: briefError } = await supabase
    .from('briefs')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (briefError) {
    throw new Error(briefError.message)
  }
  if (!brief) {
    return null
  }

  const { data: stories, error: storiesError } = await supabase
    .from('stories')
    .select('*')
    .eq('brief_id', brief.id)
    .order('position', { ascending: true })

  if (storiesError) {
    throw new Error(storiesError.message)
  }

  return { brief, stories: stories ?? [] }
}
