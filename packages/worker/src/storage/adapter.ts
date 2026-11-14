// 对象存储的最小契约。业务层只认这个接口，不认具体厂商：
// 换存储时只改 index.ts 的 createStorage，routes/files.ts 一行都不用动。

export interface ObjectMeta {
  etag: string;
  size: number;
  contentType: string;
}

export interface ObjectGet {
  body: ReadableStream;
  etag: string;
  size: number;        // 对象总大小，不是本次返回的字节数
  contentType: string;
  partial: boolean;    // 服务端是否按 Range 返回了 206
}

export interface ObjectRange {
  offset: number;
  end?: number;
}

export interface StorageAdapter {
  put(key: string, data: ArrayBuffer | Uint8Array, contentType: string): Promise<{ etag: string }>;
  head(key: string): Promise<ObjectMeta | null>;
  get(key: string, range?: ObjectRange): Promise<ObjectGet | null>;
  presignGet(key: string, ttl: number): Promise<string>;
  presignPut(key: string, contentType: string, ttl: number): Promise<string>;
  delete(key: string): Promise<void>;
}
