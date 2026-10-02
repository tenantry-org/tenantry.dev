export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      customer_access: {
        Row: {
          customer_id: string;
          github_invited_at: string | null;
          github_state: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          customer_id: string;
          github_invited_at?: string | null;
          github_state?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          customer_id?: string;
          github_invited_at?: string | null;
          github_state?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_access_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      customer_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          customer_id: string | null;
          event_type: string | null;
          id: string;
          kind: string;
          last_error: string | null;
          locked_until: string | null;
          next_attempt_at: string;
          occurred_at: string;
          payload: Json | null;
          processed_at: string | null;
          status: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          customer_id?: string | null;
          event_type?: string | null;
          id: string;
          kind: string;
          last_error?: string | null;
          locked_until?: string | null;
          next_attempt_at?: string;
          occurred_at: string;
          payload?: Json | null;
          processed_at?: string | null;
          status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          customer_id?: string | null;
          event_type?: string | null;
          id?: string;
          kind?: string;
          last_error?: string | null;
          locked_until?: string | null;
          next_attempt_at?: string;
          occurred_at?: string;
          payload?: Json | null;
          processed_at?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          created_at: string;
          customer_id: string;
          email: string;
          last_event_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          email: string;
          last_event_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          email?: string;
          last_event_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      entitlements: {
        Row: {
          created_at: string;
          current_period_ends_at: string | null;
          customer_id: string;
          grace_started_at: string | null;
          id: string;
          revoked_at: string | null;
          status: string;
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_period_ends_at?: string | null;
          customer_id: string;
          grace_started_at?: string | null;
          id?: string;
          revoked_at?: string | null;
          status: string;
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_period_ends_at?: string | null;
          customer_id?: string;
          grace_started_at?: string | null;
          id?: string;
          revoked_at?: string | null;
          status?: string;
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entitlements_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'entitlements_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: true;
            referencedRelation: 'subscriptions';
            referencedColumns: ['subscription_id'];
          },
        ];
      };
      github_links: {
        Row: {
          customer_id: string;
          github_id: number;
          github_login: string;
          linked_at: string;
        };
        Insert: {
          customer_id: string;
          github_id: number;
          github_login: string;
          linked_at?: string;
        };
        Update: {
          customer_id?: string;
          github_id?: number;
          github_login?: string;
          linked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'github_links_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      licence_failures: {
        Row: {
          attempts: number;
          customer_id: string;
          failing_since: string;
          last_attempt_at: string;
          last_error: string;
        };
        Insert: {
          attempts?: number;
          customer_id: string;
          failing_since?: string;
          last_attempt_at?: string;
          last_error: string;
        };
        Update: {
          attempts?: number;
          customer_id?: string;
          failing_since?: string;
          last_attempt_at?: string;
          last_error?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'licence_failures_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      licences: {
        Row: {
          customer_id: string;
          id: string;
          issued_at: string;
          jwt: string;
          revoked: boolean;
        };
        Insert: {
          customer_id: string;
          id?: string;
          issued_at?: string;
          jwt: string;
          revoked?: boolean;
        };
        Update: {
          customer_id?: string;
          id?: string;
          issued_at?: string;
          jwt?: string;
          revoked?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'licences_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          customer_id: string;
          last_event_at: string | null;
          price_id: string | null;
          product_id: string | null;
          scheduled_change_action: string | null;
          scheduled_change_at: string | null;
          status: string;
          subscription_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          last_event_at?: string | null;
          price_id?: string | null;
          product_id?: string | null;
          scheduled_change_action?: string | null;
          scheduled_change_at?: string | null;
          status: string;
          subscription_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          last_event_at?: string | null;
          price_id?: string | null;
          product_id?: string | null;
          scheduled_change_action?: string | null;
          scheduled_change_at?: string | null;
          status?: string;
          subscription_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_customer_lease: { Args: { p_customer_id: string; p_seconds: number }; Returns: string };
      claim_customer_jobs: {
        Args: { p_limit: number; p_lock_seconds: number };
        Returns: {
          attempts: number;
          created_at: string;
          customer_id: string | null;
          event_type: string | null;
          id: string;
          kind: string;
          last_error: string | null;
          locked_until: string | null;
          next_attempt_at: string;
          occurred_at: string;
          payload: Json | null;
          processed_at: string | null;
          status: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'customer_jobs';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      customers_to_reconcile: { Args: Record<PropertyKey, never>; Returns: string[] };
      record_customer_event: {
        Args: { p_customer_id: string; p_email: string; p_occurred_at: string };
        Returns: boolean;
      };
      record_licence_failure: { Args: { p_customer_id: string; p_error: string }; Returns: boolean };
      record_subscription_event: {
        Args: {
          p_customer_id: string;
          p_occurred_at: string;
          p_price_id: string;
          p_product_id: string;
          p_scheduled_change_action: string;
          p_scheduled_change_at: string;
          p_status: string;
          p_subscription_id: string;
        };
        Returns: boolean;
      };
      release_customer_lease: { Args: { p_lease_id: string }; Returns: undefined };
      set_customer_access: { Args: { p_customer_id: string; p_status: string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
