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
          extracted_at: string
          id: string
          metadata: Json | null
          published_at: string | null
          publisher_id: string
          run_id: string
          title: string | null
        }
        Insert: {
          body_text?: string | null
          canonical_url: string
          extracted_at?: string
          id?: string
          metadata?: Json | null
          published_at?: string | null
          publisher_id: string
          run_id: string
          title?: string | null
        }
        Update: {
          body_text?: string | null
          canonical_url?: string
          extracted_at?: string
          id?: string
          metadata?: Json | null
          published_at?: string | null
          publisher_id?: string
          run_id?: string
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
          ended_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
        }
        Insert: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Update: {
          ended_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
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
      run_status: ["pending", "running", "completed", "failed", "cancelled"],
    },
  },
} as const
