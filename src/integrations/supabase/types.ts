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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      alert_templates: {
        Row: {
          created_at: string
          duration_seconds: number
          id: string
          message: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          id?: string
          message: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          id?: string
          message?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          auto_publish: boolean
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          auto_publish?: boolean
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          auto_publish?: boolean
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_photos: {
        Row: {
          created_at: string
          device_hash: string | null
          featured: boolean
          id: string
          image_url: string
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_hash?: string | null
          featured?: boolean
          id?: string
          image_url: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_hash?: string | null
          featured?: boolean
          id?: string
          image_url?: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      live_frames: {
        Row: {
          created_at: string
          frame_data: string
          id: string
        }
        Insert: {
          created_at?: string
          frame_data: string
          id?: string
        }
        Update: {
          created_at?: string
          frame_data?: string
          id?: string
        }
        Relationships: []
      }
      media: {
        Row: {
          created_at: string
          duration: number
          file_size: number | null
          id: string
          qr_url: string | null
          resolution: string | null
          storage_path: string | null
          title: string
          type: string
          url: string
        }
        Insert: {
          created_at?: string
          duration?: number
          file_size?: number | null
          id?: string
          qr_url?: string | null
          resolution?: string | null
          storage_path?: string | null
          title: string
          type?: string
          url: string
        }
        Update: {
          created_at?: string
          duration?: number
          file_size?: number | null
          id?: string
          qr_url?: string | null
          resolution?: string | null
          storage_path?: string | null
          title?: string
          type?: string
          url?: string
        }
        Relationships: []
      }
      playlists: {
        Row: {
          created_at: string
          id: string
          items: Json
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          name?: string
        }
        Relationships: []
      }
      tv_alerts: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          message: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          message: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          message?: string
        }
        Relationships: []
      }
      tvs: {
        Row: {
          command: Json | null
          created_at: string
          device_uuid: string | null
          event_mode: boolean
          id: string
          is_live_active: boolean
          is_paired: boolean
          last_ping: string | null
          layout_mode: string
          live_stream_url: string | null
          memory_usage: string | null
          muted: boolean
          name: string
          orientation: string
          pairing_code: string
          playlist_id: string | null
          qr_url: string | null
          screen_resolution: string | null
          ticker_text: string | null
        }
        Insert: {
          command?: Json | null
          created_at?: string
          device_uuid?: string | null
          event_mode?: boolean
          id?: string
          is_live_active?: boolean
          is_paired?: boolean
          last_ping?: string | null
          layout_mode?: string
          live_stream_url?: string | null
          memory_usage?: string | null
          muted?: boolean
          name?: string
          orientation?: string
          pairing_code: string
          playlist_id?: string | null
          qr_url?: string | null
          screen_resolution?: string | null
          ticker_text?: string | null
        }
        Update: {
          command?: Json | null
          created_at?: string
          device_uuid?: string | null
          event_mode?: boolean
          id?: string
          is_live_active?: boolean
          is_paired?: boolean
          last_ping?: string | null
          layout_mode?: string
          live_stream_url?: string | null
          memory_usage?: string | null
          muted?: boolean
          name?: string
          orientation?: string
          pairing_code?: string
          playlist_id?: string | null
          qr_url?: string | null
          screen_resolution?: string | null
          ticker_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tvs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_ghost_tvs: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      register_tv: { Args: { _code: string }; Returns: string }
      register_tv_device:
        | { Args: { _code?: string; _device_uuid: string }; Returns: Json }
        | { Args: { p_device_uuid: string }; Returns: Json }
      submit_event_photo: {
        Args: {
          _device_hash: string
          _image_url: string
          _storage_path: string
        }
        Returns: string
      }
      tv_heartbeat: {
        Args: { _id: string; _memory?: string; _resolution?: string }
        Returns: undefined
      }
      tv_ping: { Args: { _id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
