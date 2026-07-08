-- ============================================================
-- Canvara Migration 12: polling instruments (M11)
-- Question kinds (cold-test intention, issue ranking) and the
-- pre/post protocol that measures whether a conversation moved
-- the voter's cold answer.
-- ============================================================

-- 'choice' — today's fixed-choice question, asked after the conversation.
-- 'intention' — the cold test (our candidate / opponent / undecided /
--   won't say), asked before AND re-asked after: the persuasion delta.
-- 'rank' — top-3 of a curated issue list (options holds issue ids).
alter table survey_questions add column if not exists kind text not null default 'choice'
  check (kind in ('choice','intention','rank'));

-- 'pre' = cold bookend, 'post' = after the conversation, 'only' = today's
-- single-ask questions.
alter table survey_responses add column if not exists phase text not null default 'only'
  check (phase in ('pre','post','only'));

-- Ordered answers for rank questions (issue ids, most important first).
alter table survey_responses add column if not exists answer_items text[];
alter table survey_responses alter column answer drop not null;
alter table survey_responses add constraint survey_responses_answer_present
  check (answer is not null or answer_items is not null);

-- One response per question per conversation PER PHASE (pre + post pairs).
alter table survey_responses
  drop constraint survey_responses_question_id_conversation_id_key;
alter table survey_responses
  add constraint survey_responses_question_convo_phase_key
  unique (question_id, conversation_id, phase);
