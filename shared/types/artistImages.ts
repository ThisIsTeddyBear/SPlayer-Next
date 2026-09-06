/** Fanart.tv 歌手图片服务状态 */
export interface ArtistImageProviderStatus {
  hasPersonalApiKey: boolean;
}

/** 渲染进程歌手图片 API */
export interface ArtistImagesApi {
  getStatus: () => Promise<ArtistImageProviderStatus>;
  savePersonalApiKey: (apiKey: string) => Promise<ArtistImageProviderStatus>;
  clearPersonalApiKey: () => Promise<ArtistImageProviderStatus>;
}
