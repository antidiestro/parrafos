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
      brief_sections: {
        Row: {
          brief_id: string
          created_at: string
          id: string
          markdown: string
          position: number
          story_id: string
          updated_at: string
        }
        Insert: {
          brief_id: string
          created_at?: string
          id?: string
          markdown: string
          position: number
          story_id: string
          updated_at?: string
        }
        Update: {
          brief_id?: string
          created_at?: string
          id?: string
          markdown?: string
          position?: number
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_sections_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_sections_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
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
      run_discovery_candidates: {
        Row: {
          canonical_urls: string[]
          created_at: string
          run_id: string
        }
        Insert: {
          canonical_urls: string[]
          created_at?: string
          run_id: string
        }
        Update: {
          canonical_urls?: string[]
          created_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_discovery_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          cluster_model: string | null
          ended_at: string | null
          error_message: string | null
          extract_model: string | null
          id: string
          metadata: Json | null
          relevance_model: string | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
        }
        Insert: {
          cluster_model?: string | null
          ended_at?: string | null
          error_message?: string | null
          extract_model?: string | null
          id?: string
          metadata?: Json | null
          relevance_model?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Update: {
          cluster_model?: string | null
          ended_at?: string | null
          error_message?: string | null
          extract_model?: string | null
          id?: string
          metadata?: Json | null
          relevance_model?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Relationships: []
      }
      stories: {
        Row: {
          brief_id: string
          created_at: string
          detail_markdown: string | null
          id: string
          markdown: string
          position: number
          updated_at: string
        }
        Insert: {
          brief_id: string
          created_at?: string
          detail_markdown?: string | null
          id?: string
          markdown: string
          position: number
          updated_at?: string
        }
        Update: {
          brief_id?: string
          created_at?: string
          detail_markdown?: string | null
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
      run_status: "running" | "completed" | "failed"
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
      run_status: ["running", "completed", "failed"],
    },
  },
} as const
