-- Split publish workflow into explicit stages while keeping legacy value.
alter type public.run_stage add value if not exists 'generate_story_summaries';
alter type public.run_stage add value if not exists 'compose_brief_paragraphs';
alter type public.run_stage add value if not exists 'persist_brief_output';
