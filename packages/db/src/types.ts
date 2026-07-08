// Database types for Canvara schema v1
// (supabase/migrations/00000000000001_schema_v1.sql).
//
// Authored in the `supabase gen types typescript` output format. Regenerate
// from the live database with `npm run gen:types` (requires SUPABASE_DB_URL
// in .env) whenever the schema changes — the generated output also fills in
// full Relationships metadata.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      campaigns: {
        Row: {
          id: string;
          name: string;
          state: string;
          consent_mode: string;
          retention_days: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          state: string;
          consent_mode?: string;
          retention_days?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          state?: string;
          consent_mode?: string;
          retention_days?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          campaign_id: string;
          role: string;
          full_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          campaign_id: string;
          role: string;
          full_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          role?: string;
          full_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      voters: {
        Row: {
          id: string;
          campaign_id: string;
          external_id: string | null;
          first_name: string | null;
          last_name: string | null;
          address: string | null;
          city: string | null;
          zip: string | null;
          precinct: string | null;
          party: string | null;
          race: string | null;
          income_bracket: string | null;
          education: string | null;
          religion: string | null;
          birth_year: number | null;
          gender: string | null;
          vote_history: Json | null;
          location: unknown | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          external_id?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          address?: string | null;
          city?: string | null;
          zip?: string | null;
          precinct?: string | null;
          party?: string | null;
          race?: string | null;
          income_bracket?: string | null;
          education?: string | null;
          religion?: string | null;
          birth_year?: number | null;
          gender?: string | null;
          vote_history?: Json | null;
          location?: unknown | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          external_id?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          address?: string | null;
          city?: string | null;
          zip?: string | null;
          precinct?: string | null;
          party?: string | null;
          race?: string | null;
          income_bracket?: string | null;
          education?: string | null;
          religion?: string | null;
          birth_year?: number | null;
          gender?: string | null;
          vote_history?: Json | null;
          location?: unknown | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voters_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      issues: {
        Row: {
          id: string;
          parent_id: string | null;
          label: string;
          pew_gallup_mapping: string | null;
        };
        Insert: {
          id: string;
          parent_id?: string | null;
          label: string;
          pew_gallup_mapping?: string | null;
        };
        Update: {
          id?: string;
          parent_id?: string | null;
          label?: string;
          pew_gallup_mapping?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "issues_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      walk_lists: {
        Row: {
          id: string;
          campaign_id: string;
          name: string;
          assigned_to: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          name: string;
          assigned_to?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          name?: string;
          assigned_to?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "walk_lists_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walk_lists_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      walk_list_items: {
        Row: {
          id: string;
          campaign_id: string;
          walk_list_id: string;
          voter_id: string;
          position: number;
          status: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          walk_list_id: string;
          voter_id: string;
          position: number;
          status?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          walk_list_id?: string;
          voter_id?: string;
          position?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "walk_list_items_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walk_list_items_walk_list_id_fkey";
            columns: ["walk_list_id"];
            isOneToOne: false;
            referencedRelation: "walk_lists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walk_list_items_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "voters";
            referencedColumns: ["id"];
          },
        ];
      };
      shifts: {
        Row: {
          id: string;
          campaign_id: string;
          canvasser_id: string;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          canvasser_id: string;
          started_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          canvasser_id?: string;
          started_at?: string;
          ended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_canvasser_id_fkey";
            columns: ["canvasser_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          campaign_id: string;
          shift_id: string | null;
          canvasser_id: string;
          voter_id: string | null;
          voter_id_manual: boolean;
          audio_path: string | null;
          recorded_at: string;
          gps: unknown | null;
          consent_disclosed_at: string | null;
          contact_result: string | null;
          status: string;
          transcript: Json | null;
          wer_estimate: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          shift_id?: string | null;
          canvasser_id: string;
          voter_id?: string | null;
          voter_id_manual?: boolean;
          audio_path?: string | null;
          recorded_at: string;
          gps?: unknown | null;
          consent_disclosed_at?: string | null;
          contact_result?: string | null;
          status?: string;
          transcript?: Json | null;
          wer_estimate?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          shift_id?: string | null;
          canvasser_id?: string;
          voter_id?: string | null;
          voter_id_manual?: boolean;
          audio_path?: string | null;
          recorded_at?: string;
          gps?: unknown | null;
          consent_disclosed_at?: string | null;
          contact_result?: string | null;
          status?: string;
          transcript?: Json | null;
          wer_estimate?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_canvasser_id_fkey";
            columns: ["canvasser_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "voters";
            referencedColumns: ["id"];
          },
        ];
      };
      signals: {
        Row: {
          id: string;
          campaign_id: string;
          conversation_id: string;
          support_level: string | null;
          top_issues: string[] | null;
          issue_sentiment: Json | null;
          emotional_valence: string | null;
          persuadability: string | null;
          information_gaps: string[] | null;
          message_resonance: Json | null;
          follow_up_signals: string[] | null;
          provenance: Json | null;
          confidence_score: number;
          model_used: string;
          prompt_version: string;
          canvasser_confirmed: boolean | null;
          debrief_summary: string | null;
          personal_context: string[] | null;
          corrections: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          conversation_id: string;
          support_level?: string | null;
          top_issues?: string[] | null;
          issue_sentiment?: Json | null;
          emotional_valence?: string | null;
          persuadability?: string | null;
          information_gaps?: string[] | null;
          message_resonance?: Json | null;
          follow_up_signals?: string[] | null;
          provenance?: Json | null;
          confidence_score: number;
          model_used: string;
          prompt_version: string;
          canvasser_confirmed?: boolean | null;
          debrief_summary?: string | null;
          personal_context?: string[] | null;
          corrections?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          conversation_id?: string;
          support_level?: string | null;
          top_issues?: string[] | null;
          issue_sentiment?: Json | null;
          emotional_valence?: string | null;
          persuadability?: string | null;
          information_gaps?: string[] | null;
          message_resonance?: Json | null;
          follow_up_signals?: string[] | null;
          provenance?: Json | null;
          confidence_score?: number;
          model_used?: string;
          prompt_version?: string;
          canvasser_confirmed?: boolean | null;
          debrief_summary?: string | null;
          personal_context?: string[] | null;
          corrections?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signals_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signals_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      belief_states: {
        Row: {
          campaign_id: string;
          voter_id: string;
          issue_id: string;
          alpha: number;
          beta: number;
          source: string;
          last_observed_at: string | null;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          voter_id: string;
          issue_id: string;
          alpha?: number;
          beta?: number;
          source?: string;
          last_observed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          voter_id?: string;
          issue_id?: string;
          alpha?: number;
          beta?: number;
          source?: string;
          last_observed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "belief_states_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "belief_states_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "voters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "belief_states_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      review_queue: {
        Row: {
          id: string;
          campaign_id: string;
          conversation_id: string;
          reason: string;
          status: string;
          resolved_by: string | null;
          resolution: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          conversation_id: string;
          reason: string;
          status?: string;
          resolved_by?: string | null;
          resolution?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          conversation_id?: string;
          reason?: string;
          status?: string;
          resolved_by?: string | null;
          resolution?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_queue_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_queue_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_queue_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          campaign_id: string;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          campaign_id: string;
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          campaign_id?: string;
          actor_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          detail?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      voter_attributes: {
        Row: {
          id: string;
          campaign_id: string;
          voter_id: string;
          key: string;
          value: string;
          source: string;
          noted_by: string | null;
          conversation_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          voter_id: string;
          key: string;
          value: string;
          source: string;
          noted_by?: string | null;
          conversation_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          voter_id?: string;
          key?: string;
          value?: string;
          source?: string;
          noted_by?: string | null;
          conversation_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      survey_questions: {
        Row: {
          id: string;
          campaign_id: string;
          question: string;
          options: string[];
          active: boolean;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          question: string;
          options: string[];
          active?: boolean;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          question?: string;
          options?: string[];
          active?: boolean;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      survey_responses: {
        Row: {
          id: string;
          campaign_id: string;
          question_id: string;
          conversation_id: string;
          voter_id: string | null;
          answer: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          question_id: string;
          conversation_id: string;
          voter_id?: string | null;
          answer: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          question_id?: string;
          conversation_id?: string;
          voter_id?: string | null;
          answer?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_responses_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "survey_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      cohorts: {
        Row: {
          id: string;
          campaign_id: string;
          name: string;
          definition: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          name: string;
          definition: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          name?: string;
          definition?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      campaign_events: {
        Row: {
          id: string;
          campaign_id: string;
          kind: string;
          title: string;
          location: unknown;
          address: string | null;
          held_at: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          kind: string;
          title: string;
          location: unknown;
          address?: string | null;
          held_at: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          kind?: string;
          title?: string;
          location?: unknown;
          address?: string | null;
          held_at?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      yard_signs: {
        Row: {
          id: string;
          campaign_id: string;
          voter_id: string | null;
          location: unknown;
          address: string | null;
          placed_at: string;
          placed_by: string | null;
          removed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          voter_id?: string | null;
          location: unknown;
          address?: string | null;
          placed_at?: string;
          placed_by?: string | null;
          removed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          voter_id?: string | null;
          location?: unknown;
          address?: string | null;
          placed_at?: string;
          placed_by?: string | null;
          removed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      contact_log: {
        Row: {
          id: string;
          campaign_id: string;
          voter_id: string;
          method: string;
          contacted_at: string;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          voter_id: string;
          method: string;
          contacted_at?: string;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          voter_id?: string;
          method?: string;
          contacted_at?: string;
          source?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          campaign_id: string;
          kind: string;
          cohort_id: string | null;
          voter_id: string | null;
          issue_id: string | null;
          goal: string;
          title: string;
          body: string;
          rationale: string | null;
          evidence: Json;
          guardrail: Json | null;
          guardrail_verdict: string | null;
          status: string;
          model_used: string;
          prompt_version: string;
          created_by: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          kind: string;
          cohort_id?: string | null;
          voter_id?: string | null;
          issue_id?: string | null;
          goal: string;
          title: string;
          body: string;
          rationale?: string | null;
          evidence?: Json;
          guardrail?: Json | null;
          guardrail_verdict?: string | null;
          status?: string;
          model_used: string;
          prompt_version: string;
          created_by?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          kind?: string;
          cohort_id?: string | null;
          voter_id?: string | null;
          issue_id?: string | null;
          goal?: string;
          title?: string;
          body?: string;
          rationale?: string | null;
          evidence?: Json;
          guardrail?: Json | null;
          guardrail_verdict?: string | null;
          status?: string;
          model_used?: string;
          prompt_version?: string;
          created_by?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_cohort_id_fkey";
            columns: ["cohort_id"];
            isOneToOne: false;
            referencedRelation: "cohorts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "voters";
            referencedColumns: ["id"];
          },
        ];
      };
      cohort_issue_priors: {
        Row: {
          id: string;
          campaign_id: string;
          cohort_id: string;
          issue_id: string;
          stance: Json;
          source: string;
          as_of: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          cohort_id: string;
          issue_id: string;
          stance: Json;
          source: string;
          as_of: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          cohort_id?: string;
          issue_id?: string;
          stance?: Json;
          source?: string;
          as_of?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      voter_coords: {
        Row: {
          voter_id: string;
          campaign_id: string;
          lat: number;
          lng: number;
        };
        Relationships: [];
      };
      pulse_support_distribution: {
        Row: {
          campaign_id: string;
          support_level: string;
          n: number;
        };
        Relationships: [];
      };
      pulse_issue_salience: {
        Row: {
          campaign_id: string;
          issue: string;
          mentions: number;
          spontaneous: number;
          negative: number;
          positive: number;
          neutral_mixed: number;
        };
        Relationships: [];
      };
      pulse_daily_trend: {
        Row: {
          campaign_id: string;
          day: string;
          support_level: string;
          n: number;
        };
        Relationships: [];
      };
      pipeline_health: {
        Row: {
          campaign_id: string;
          status: string;
          n: number;
          newest: string;
          oldest_in_flight: string | null;
        };
        Relationships: [];
      };
      voter_map_points: {
        Row: {
          voter_id: string;
          campaign_id: string;
          party: string | null;
          lat: number;
          lng: number;
        };
        Relationships: [];
      };
      sign_map_points: {
        Row: {
          sign_id: string;
          campaign_id: string;
          address: string | null;
          placed_at: string;
          lat: number;
          lng: number;
        };
        Relationships: [];
      };
      event_map_points: {
        Row: {
          event_id: string;
          campaign_id: string;
          kind: string;
          title: string;
          held_at: string;
          lat: number;
          lng: number;
        };
        Relationships: [];
      };
      turnout_by_election: {
        Row: {
          campaign_id: string;
          election: string;
          voted: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_campaign_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_role_in_campaign: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      correlate_voter: {
        Args: {
          p_campaign_id: string;
          p_lat: number;
          p_lng: number;
          p_max_meters?: number;
        };
        Returns: {
          voter_id: string;
          distance_m: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
