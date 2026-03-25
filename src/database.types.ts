export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Matches public.brief_status */
export type BriefStatus = "draft" | "published";

/** Matches public.run_status */
export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type Database = {
  public: {
    Tables: {
      articles: {
        Row: {
          id: string;
          publisher_id: string;
          run_id: string;
          canonical_url: string;
          title: string | null;
          body_text: string | null;
          extracted_at: string;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          publisher_id: string;
          run_id: string;
          canonical_url: string;
          title?: string | null;
          body_text?: string | null;
          extracted_at?: string;
          metadata?: Json | null;
        };
        Update: {
          id?: string;
          publisher_id?: string;
          run_id?: string;
          canonical_url?: string;
          title?: string | null;
          body_text?: string | null;
          extracted_at?: string;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "articles_publisher_id_fkey";
            columns: ["publisher_id"];
            isOneToOne: false;
            referencedRelation: "publishers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "articles_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      briefs: {
        Row: {
          id: string;
          title: string | null;
          status: BriefStatus;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title?: string | null;
          status?: BriefStatus;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string | null;
          status?: BriefStatus;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      publishers: {
        Row: {
          id: string;
          name: string;
          base_url: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          base_url: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          base_url?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      runs: {
        Row: {
          id: string;
          started_at: string;
          ended_at: string | null;
          status: RunStatus;
          error_message: string | null;
          metadata: Json | null;
        };
        Insert: {
          id?: string;
          started_at?: string;
          ended_at?: string | null;
          status?: RunStatus;
          error_message?: string | null;
          metadata?: Json | null;
        };
        Update: {
          id?: string;
          started_at?: string;
          ended_at?: string | null;
          status?: RunStatus;
          error_message?: string | null;
          metadata?: Json | null;
        };
        Relationships: [];
      };
      stories: {
        Row: {
          id: string;
          brief_id: string;
          position: number;
          markdown: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brief_id: string;
          position: number;
          markdown: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brief_id?: string;
          position?: number;
          markdown?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stories_brief_id_fkey";
            columns: ["brief_id"];
            isOneToOne: false;
            referencedRelation: "briefs";
            referencedColumns: ["id"];
          },
        ];
      };
      story_articles: {
        Row: {
          story_id: string;
          article_id: string;
          note: string | null;
        };
        Insert: {
          story_id: string;
          article_id: string;
          note?: string | null;
        };
        Update: {
          story_id?: string;
          article_id?: string;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "story_articles_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_articles_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      brief_status: "draft" | "published";
      run_status: "pending" | "running" | "completed" | "failed" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] &
        Database["public"]["Views"])
    ? (Database["public"]["Tables"] &
        Database["public"]["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database["public"]["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof Database["public"]["Enums"]
    ? Database["public"]["Enums"][PublicEnumNameOrOptions]
    : never;
