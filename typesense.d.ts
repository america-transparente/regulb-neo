declare module 'typesense' {
    export interface Typesense {
        Client: TypesenseClientCtor;
    }

    export interface TypesenseDocument {
        id: string;
    }

    export type TypesenseClientCtor = new (options: TypesenseClientOptions) => TypesenseClient;

    export interface Alias {
        name: string;
        collection_name: string;
    }

    export interface TypesenseCollection<T extends TypesenseDocument> {
        retrieve(): Promise<CollectionSchema>;

        delete(): Promise<CollectionSchema>;

        documents(): {
            create(document: T): Promise<T>;
            upsert(document: Partial<T>): Promise<T>;
            search(
                params: TypesenseRawSearchParams & { group_by: string },
            ): Promise<TypesenseRawGroupedResponse<T>>;
            search(params: TypesenseRawSearchParams): Promise<TypesenseRawResponse<T>>;
            import(documents: T[], config?: { action: 'create' | 'update' | 'upsert' }): Promise<any>;
            export(): Promise<T[]>;
            delete(query: TypesenseRawSearchParams): Promise<{ num_deleted: number }>;
        };

        documents(
            id: string,
        ): {
            retrieve(): Promise<any>;
            update(document: T): Promise<T>;
            delete(): Promise<any>;
        };
    }

    export interface TypesenseClient {
        aliases(): {
            upsert(name: string, config: { collection_name: string }): Promise<Alias>;
            retrieve(): Promise<{ aliases: Alias[] }>;
        };

        aliases(
            name: string,
        ): {
            retrieve(): Promise<Alias>;
            delete(): Promise<Alias>;
        };

        keys: (name?: string) => any;

        collections(): {
            create(schema: Omit<CollectionSchema, 'num_documents'>): Promise<CollectionSchema>;
            retrieve(): Promise<CollectionSchema[]>;
        };

        collections<T extends TypesenseDocument>(name: string): TypesenseCollection<T>;

        health: {
            retrieve: () => { ok: boolean };
        };
    }

    export interface TypesenseNodeConfig {
        host: string;
        port: number;
        protocol: 'http' | 'https';
    }

    export interface TypesenseClientOptions {
        nodes: TypesenseNodeConfig[];
        apiKey: string;
        numRetries?: number;
        connectionTimeoutSeconds?: number;
        logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    }

    export type FieldType =
        | 'string'
        | 'int32'
        | 'int64'
        | 'float'
        | 'bool'
        | 'string[]'
        | 'int32[]'
        | 'int64[]'
        | 'float[]'
        | 'bool[]';

    export interface FieldDefinition {
        name: string;
        type: FieldType;
        optional?: boolean;
        facet: boolean;
    }

    export interface CollectionSchema {
        name: string;
        num_documents: number;
        fields: FieldDefinition[];
        default_sorting_field: string;
    }

    /**
     * Ref: https://typesense.org/docs/0.19.0/api/documents.html#arguments
     */
    export interface TypesenseRawSearchParams {
        q?: string;
        query_by?: string;
        query_by_weights?: string;
        filter_by?: string;
        sort_by?: string;
        group_by?: string;
        group_limit?: number;
        prefix?: boolean;
        facet_by?: string;
        max_facet_values?: number;
        facet_query?: string;
        num_typos?: number;
        page?: number;
        per_page?: number;
        include_fields?: string;
        exclude_fields?: string;
        highlight_full_fields?: string;
        highlight_affix_num_tokens?: number;
        highlight_start_tag?: string;
        highlight_end_tag?: string;
        snippet_threshold?: number;
        drop_tokens_threshold?: number;
        typo_tokens_threshold?: number;
        pinned_hits?: string;
        hidden_hits?: string;
        limit_hits?: number;
    }

    export interface TypesenseRawResponseBase {
        facet_counts: Array<{
            counts: Array<{
                count: number;
                highlighted: string;
                value: string;
            }>;
            field_name: string;
            stats?: {
                avg: number;
                max: number;
                min: number;
                sum: number;
            };
        }>;
        found: number;
        out_of: number;
        page: number;
        request_params: Record<string, string>;
        search_time_ms: number;
    }

    export interface HighlightData {
        field: string;
        matched_tokens: string[];
        snippet: string;
    }

    export interface TypesenseHit<T extends TypesenseDocument> {
        document: T;
        highlights: HighlightData[];
        text_match: number;
    }

    export interface TypesenseRawResponse<T extends TypesenseDocument> extends TypesenseRawResponseBase {
        hits: Array<TypesenseHit<T>>;
    }

    export interface TypesenseRawGroupedResponse<T extends TypesenseDocument> extends TypesenseRawResponseBase {
        grouped_hits: Array<{
            group_key: string[];
            hits: Array<TypesenseHit<T>>;
        }>;
    }
}
