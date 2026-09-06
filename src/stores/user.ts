import { useLibraryStore } from "@/stores/library";

export const useUserStore: any = defineStore("user", () => {
  const isLoggedIn = ref(false);
  const profile = ref(null);
  const playlists = shallowRef([]);
  const createdPlaylists = shallowRef([]);
  const subscribedPlaylists = shallowRef([]);
  const artists = shallowRef([]);
  const albums = shallowRef([]);
  const likedPlaylistTracks = shallowRef([]);
  const likedPlaylistId = ref("");
  const likedPlaylistLoading = ref(false);
  const isLiked = (trackId: string): boolean => useLibraryStore().isLiked(trackId);
  const toggleLike = (trackId: string): boolean => useLibraryStore().toggleLike(trackId);
  const unavailable = async (): Promise<void> => {};

  return {
    isLoggedIn,
    profile,
    playlists,
    createdPlaylists,
    subscribedPlaylists,
    artists,
    albums,
    likedPlaylistTracks,
    likedPlaylistId,
    likedPlaylistLoading,
    isLiked,
    toggleLike,
    fetchStatus: unavailable,
    ensureLikedPlaylist: unavailable,
    createPlaylist: unavailable,
    updatePlaylist: unavailable,
    deletePlaylist: unavailable,
    addTracksToPlaylist: unavailable,
    removeTracksFromPlaylist: unavailable,
    removeCloudTracks: unavailable,
    toggleAlbumSubscribe: unavailable,
    toggleArtistSubscribe: unavailable,
    togglePlaylistSubscribe: unavailable,
  } as any;
});
