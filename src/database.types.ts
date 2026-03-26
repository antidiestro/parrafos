export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      articles: {
        Row: {
          body_text: string | null
          canonical_url: string
          clustering_model: string | null
          extracted_at: string
          extraction_model: string | null
          id: string
          metadata: Json | null
          published_at: string | null
          publisher_id: string
          relevance_selection_model: string | null
          run_id: string
          source_url: string | null
          title: string | null
        }
        Insert: {
          body_text?: string | null
          canonical_url: string
          clustering_model?: string | null
          extracted_at?: string
          extraction_model?: string | null
          id?: string
          metadata?: Json | null
          published_at?: string | null
          publisher_id: string
          relevance_selection_model?: string | null
          run_id: string
          source_url?: string | null
          title?: string | null
        }
        Update: {
          body_text?: string | null
          canonical_url?: string
          clustering_model?: string | null
          extracted_at?: string
          extraction_model?: string | null
          id?: string
          metadata?: Json | null
          published_at?: string | null
          publisher_id?: string
          relevance_selection_model?: string | null
          run_id?: string
          source_url?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          created_at: string
          id: string
          published_at: string | null
          status: Database["public"]["Enums"]["brief_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["brief_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["brief_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      publishers: {
        Row: {
          base_url: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          base_url: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          base_url?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      run_articles_progress: {
        Row: {
          canonical_url: string | null
          created_at: string
          error_message: string | null
          id: string
          published_at: string | null
          publisher_id: string
          run_id: string
          status: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          published_at?: string | null
          publisher_id: string
          run_id: string
          status: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          canonical_url?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          published_at?: string | null
          publisher_id?: string
          run_id?: string
          status?: string
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_articles_progress_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_articles_progress_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          publisher_id: string | null
          run_id: string
          stage: Database["public"]["Enums"]["run_stage"] | null
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          publisher_id?: string | null
          run_id: string
          stage?: Database["public"]["Enums"]["run_stage"] | null
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          publisher_id?: string | null
          run_id?: string
          stage?: Database["public"]["Enums"]["run_stage"] | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_errors_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_events: {
        Row: {
          context: Json | null
          created_at: string
          event_type: string
          id: string
          message: string | null
          run_id: string
          stage: Database["public"]["Enums"]["run_stage"] | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          run_id: string
          stage?: Database["public"]["Enums"]["run_stage"] | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          run_id?: string
          stage?: Database["public"]["Enums"]["run_stage"] | null
        }
        Relationships: [
          {
            foreignKeyName: "run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_publishers_progress: {
        Row: {
          articles_found: number
          articles_upserted: number
          base_url: string
          created_at: string
          error_message: string | null
          id: string
          publisher_id: string
          publisher_name: string
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          articles_found?: number
          articles_upserted?: number
          base_url: string
          created_at?: string
          error_message?: string | null
          id?: string
          publisher_id: string
          publisher_name: string
          run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          articles_found?: number
          articles_upserted?: number
          base_url?: string
          created_at?: string
          error_message?: string | null
          id?: string
          publisher_id?: string
          publisher_name?: string
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_publishers_progress_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_publishers_progress_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_stage_executions: {
        Row: {
          attempt: number
          created_at: string
          ended_at: string | null
          error_message: string | null
          heartbeat_at: string
          id: string
          resume_cursor: Json | null
          run_id: string
          stage: Database["public"]["Enums"]["run_stage"]
          started_at: string
          status: Database["public"]["Enums"]["run_stage_status"]
          updated_at: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          heartbeat_at?: string
          id?: string
          resume_cursor?: Json | null
          run_id: string
          stage: Database["public"]["Enums"]["run_stage"]
          started_at?: string
          status?: Database["public"]["Enums"]["run_stage_status"]
          updated_at?: string
        }
        Update: {
          attempt?: number
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          heartbeat_at?: string
          id?: string
          resume_cursor?: Json | null
          run_id?: string
          stage?: Database["public"]["Enums"]["run_stage"]
          started_at?: string
          status?: Database["public"]["Enums"]["run_stage_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_stage_executions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_story_cluster_sources: {
        Row: {
          canonical_url: string
          cluster_id: string
          created_at: string
          published_at: string | null
          publisher_id: string
          run_id: string
          title: string | null
          url: string
        }
        Insert: {
          canonical_url: string
          cluster_id: string
          created_at?: string
          published_at?: string | null
          publisher_id: string
          run_id: string
          title?: string | null
          url: string
        }
        Update: {
          canonical_url?: string
          cluster_id?: string
          created_at?: string
          published_at?: string | null
          publisher_id?: string
          run_id?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_story_cluster_sources_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "run_story_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_story_cluster_sources_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_story_cluster_sources_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_story_clusters: {
        Row: {
          created_at: string
          id: string
          run_id: string
          selection_reason: string | null
          source_count: number
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          run_id: string
          selection_reason?: string | null
          source_count?: number
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          run_id?: string
          selection_reason?: string | null
          source_count?: number
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_story_clusters_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          articles_found: number
          articles_upserted: number
          cluster_model: string | null
          clusters_eligible: number
          clusters_selected: number
          clusters_total: number
          current_stage: Database["public"]["Enums"]["run_stage"] | null
          ended_at: string | null
          error_message: string | null
          extract_model: string | null
          id: string
          last_heartbeat_at: string | null
          metadata: Json | null
          publisher_count: number
          publishers_done: number
          relevance_model: string | null
          sources_selected: number
          stage_attempt: number
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
        }
        Insert: {
          articles_found?: number
          articles_upserted?: number
          cluster_model?: string | null
          clusters_eligible?: number
          clusters_selected?: number
          clusters_total?: number
          current_stage?: Database["public"]["Enums"]["run_stage"] | null
          ended_at?: string | null
          error_message?: string | null
          extract_model?: string | null
          id?: string
          last_heartbeat_at?: string | null
          metadata?: Json | null
          publisher_count?: number
          publishers_done?: number
          relevance_model?: string | null
          sources_selected?: number
          stage_attempt?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Update: {
          articles_found?: number
          articles_upserted?: number
          cluster_model?: string | null
          clusters_eligible?: number
          clusters_selected?: number
          clusters_total?: number
          current_stage?: Database["public"]["Enums"]["run_stage"] | null
          ended_at?: string | null
          error_message?: string | null
          extract_model?: string | null
          id?: string
          last_heartbeat_at?: string | null
          metadata?: Json | null
          publisher_count?: number
          publishers_done?: number
          relevance_model?: string | null
          sources_selected?: number
          stage_attempt?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Relationships: []
      }
      stories: {
        Row: {
          brief_id: string
          created_at: string
          id: string
          markdown: string
          position: number
          updated_at: string
        }
        Insert: {
          brief_id: string
          created_at?: string
          id?: string
          markdown: string
          position: number
          updated_at?: string
        }
        Update: {
          brief_id?: string
          created_at?: string
          id?: string
          markdown?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      story_articles: {
        Row: {
          article_id: string
          note: string | null
          story_id: string
        }
        Insert: {
          article_id: string
          note?: string | null
          story_id: string
        }
        Update: {
          article_id?: string
          note?: string | null
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_articles_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_articles_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      brief_status: "draft" | "published"
      run_stage:
        | "discover_candidates"
        | "prefetch_metadata"
        | "cluster_sources"
        | "select_clusters"
        | "extract_bodies"
        | "upsert_articles"
        | "publish_brief"
      run_stage_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      run_status: "pending" | "running" | "completed" | "failed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      brief_status: ["draft", "published"],
      run_stage: [
        "discover_candidates",
        "prefetch_metadata",
        "cluster_sources",
        "select_clusters",
        "extract_bodies",
        "upsert_articles",
        "publish_brief",
      ],
      run_stage_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      run_status: ["pending", "running", "completed", "failed", "cancelled"],
    },
  },
} as const
