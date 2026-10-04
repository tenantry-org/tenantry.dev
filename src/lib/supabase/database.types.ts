export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      active_subscriptions: {
        Row: {
          access_status: string;
          conditional_through: string | null;
          customer_id: string;
          grace_ends_at: string | null;
          months_paid: number;
          paid_through: string | null;
          run_started_at: string | null;
          updated_at: string;
          vests_at: string | null;
        };
        Insert: {
          access_status?: string;
          conditional_through?: string | null;
          customer_id: string;
          grace_ends_at?: string | null;
          months_paid?: number;
          paid_through?: string | null;
          run_started_at?: string | null;
          updated_at?: string;
          vests_at?: string | null;
        };
        Update: {
          access_status?: string;
          conditional_through?: string | null;
          customer_id?: string;
          grace_ends_at?: string | null;
          months_paid?: number;
          paid_through?: string | null;
          run_started_at?: string | null;
          updated_at?: string;
          vests_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'active_subscriptions_customer_id_fkey';
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
      feed_tokens: {
        Row: {
          created_at: string;
          customer_id: string;
          id: string;
          last_used_at: string | null;
          name: string;
          prefix: string;
          revoked_at: string | null;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          id?: string;
          last_used_at?: string | null;
          name: string;
          prefix: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          prefix?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feed_tokens_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
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
        };
        Insert: {
          customer_id: string;
          id?: string;
          issued_at?: string;
          jwt: string;
        };
        Update: {
          customer_id?: string;
          id?: string;
          issued_at?: string;
          jwt?: string;
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
      payment_adjustments: {
        Row: {
          action: string;
          adjustment_id: string;
          approved_at: string | null;
          created_at: string;
          currency_code: string | null;
          customer_id: string;
          item_types: string[];
          last_event_at: string;
          reversed_at: string | null;
          status: string;
          subscription_id: string | null;
          subtotal: number | null;
          transaction_id: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          adjustment_id: string;
          approved_at?: string | null;
          created_at?: string;
          currency_code?: string | null;
          customer_id: string;
          item_types?: string[];
          last_event_at: string;
          reversed_at?: string | null;
          status: string;
          subscription_id?: string | null;
          subtotal?: number | null;
          transaction_id: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          adjustment_id?: string;
          approved_at?: string | null;
          created_at?: string;
          currency_code?: string | null;
          customer_id?: string;
          item_types?: string[];
          last_event_at?: string;
          reversed_at?: string | null;
          status?: string;
          subscription_id?: string | null;
          subtotal?: number | null;
          transaction_id?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_adjustments_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      payments: {
        Row: {
          billing_frequency: number;
          billing_interval: string;
          completed_at: string;
          created_at: string;
          currency_code: string;
          customer_id: string;
          discount: number;
          last_event_at: string;
          origin: string;
          period_ends_at: string;
          period_starts_at: string;
          price_id: string;
          status: string;
          subscription_id: string;
          subtotal: number;
          tax: number | null;
          total: number;
          transaction_id: string;
          updated_at: string;
        };
        Insert: {
          billing_frequency: number;
          billing_interval: string;
          completed_at: string;
          created_at?: string;
          currency_code: string;
          customer_id: string;
          discount: number;
          last_event_at: string;
          origin: string;
          period_ends_at: string;
          period_starts_at: string;
          price_id: string;
          status?: string;
          subscription_id: string;
          subtotal: number;
          tax?: number | null;
          total: number;
          transaction_id: string;
          updated_at?: string;
        };
        Update: {
          billing_frequency?: number;
          billing_interval?: string;
          completed_at?: string;
          created_at?: string;
          currency_code?: string;
          customer_id?: string;
          discount?: number;
          last_event_at?: string;
          origin?: string;
          period_ends_at?: string;
          period_starts_at?: string;
          price_id?: string;
          status?: string;
          subscription_id?: string;
          subtotal?: number;
          tax?: number | null;
          total?: number;
          transaction_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      pro_packages: {
        Row: {
          authors: string | null;
          created_at: string;
          dependency_groups: NonNullable<Json>;
          description: string | null;
          lower_id: string;
          nuspec: string;
          package_id: string;
          sha512: string;
          size: number;
          storage_path: string;
          version: string;
        };
        Insert: {
          authors?: string | null;
          created_at?: string;
          dependency_groups?: NonNullable<Json>;
          description?: string | null;
          lower_id: string;
          nuspec: string;
          package_id: string;
          sha512: string;
          size: number;
          storage_path: string;
          version: string;
        };
        Update: {
          authors?: string | null;
          created_at?: string;
          dependency_groups?: NonNullable<Json>;
          description?: string | null;
          lower_id?: string;
          nuspec?: string;
          package_id?: string;
          sha512?: string;
          size?: number;
          storage_path?: string;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pro_packages_version_fkey';
            columns: ['version'];
            isOneToOne: false;
            referencedRelation: 'pro_releases';
            referencedColumns: ['version'];
          },
        ];
      };
      pro_releases: {
        Row: {
          created_at: string;
          entitlement_at: string;
          major: number;
          minor: number;
          patch: number;
          published_at: string;
          security: boolean;
          version: string;
        };
        Insert: {
          created_at?: string;
          entitlement_at: string;
          major: number;
          minor: number;
          patch: number;
          published_at: string;
          security?: boolean;
          version: string;
        };
        Update: {
          created_at?: string;
          entitlement_at?: string;
          major?: number;
          minor?: number;
          patch?: number;
          published_at?: string;
          security?: boolean;
          version?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_ends_at: string | null;
          customer_id: string;
          ended_at: string | null;
          grace_started_at: string | null;
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
          current_period_ends_at?: string | null;
          customer_id: string;
          ended_at?: string | null;
          grace_started_at?: string | null;
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
          current_period_ends_at?: string | null;
          customer_id?: string;
          ended_at?: string | null;
          grace_started_at?: string | null;
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
      vested_entitlements: {
        Row: {
          confirmed_at: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          kind: string;
          note: string | null;
          started_at: string;
          status: string;
          transaction_id: string | null;
          updated_at: string;
          vested_through: string;
          withdrawn_reason: string | null;
        };
        Insert: {
          confirmed_at?: string | null;
          created_at?: string;
          customer_id: string;
          id?: string;
          kind: string;
          note?: string | null;
          started_at: string;
          status: string;
          transaction_id?: string | null;
          updated_at?: string;
          vested_through: string;
          withdrawn_reason?: string | null;
        };
        Update: {
          confirmed_at?: string | null;
          created_at?: string;
          customer_id?: string;
          id?: string;
          kind?: string;
          note?: string | null;
          started_at?: string;
          status?: string;
          transaction_id?: string | null;
          updated_at?: string;
          vested_through?: string;
          withdrawn_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'vested_entitlements_customer_id_fkey';
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
      create_feed_token: {
        Args: { p_customer_id: string; p_name: string; p_prefix: string; p_token_hash: string };
        Returns: string;
      };
      customers_to_reconcile: { Args: Record<PropertyKey, never>; Returns: string[] };
      feed_customer: {
        Args: { p_token_hash: string };
        Returns: {
          access_status: string;
          customer_id: string;
          grace_ends_at: string;
          vested_through: string;
        }[];
      };
      record_customer_event: {
        Args: { p_customer_id: string; p_email: string; p_occurred_at: string };
        Returns: boolean;
      };
      record_licence_failure: { Args: { p_customer_id: string; p_error: string }; Returns: boolean };
      record_payment: {
        Args: {
          p_billing_frequency: number;
          p_billing_interval: string;
          p_currency_code: string;
          p_customer_id: string;
          p_discount: number;
          p_occurred_at: string;
          p_origin: string;
          p_period_ends_at: string;
          p_period_starts_at: string;
          p_price_id: string;
          p_subscription_id: string;
          p_subtotal: number;
          p_tax: number;
          p_total: number;
          p_transaction_id: string;
        };
        Returns: boolean;
      };
      record_payment_adjustment: {
        Args: {
          p_action: string;
          p_adjustment_id: string;
          p_created_at: string;
          p_currency_code: string;
          p_customer_id: string;
          p_item_types: string[];
          p_occurred_at: string;
          p_status: string;
          p_subscription_id: string;
          p_subtotal: number;
          p_transaction_id: string;
          p_type: string;
          p_updated_at: string;
        };
        Returns: boolean;
      };
      record_subscription_event: {
        Args: {
          p_current_period_ends_at: string;
          p_customer_id: string;
          p_ended_at: string;
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
      revoke_feed_token: { Args: { p_customer_id: string; p_token_id: string }; Returns: boolean };
      set_customer_entitlement: {
        Args: { p_customer_id: string; p_grants: Json; p_payment_statuses: Json; p_state: Json };
        Returns: string;
      };
      vested_through: { Args: { p_customer_id: string }; Returns: string };
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
