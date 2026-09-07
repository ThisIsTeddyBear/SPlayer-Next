import type { TrackFee } from "@shared/types/player";

/**
 */

export interface NeteaseArtist {
  id: number;
  name: string;
  tns?: string[];
  alias?: string[];
}

export interface NeteaseAlbumLite {
  id: number;
  name: string;
  picUrl: string;
  tns?: string[];
  pic_str?: string;
  publishTime?: number;
}

export interface NeteaseQuality {
  br: number;
  fid: number;
  size: number;
  vd: number;
  sr: number;
}

export interface NeteaseFreeTrialPrivilege {
  userConsumable: boolean;
  resConsumable: boolean;
}

export interface NeteaseChargeInfo {
  rate: number;
  chargeType: number;
}

export interface NeteasePrivilege {
  id: number;
  fee: TrackFee;
  payed: number;
  st: number;
  pl: number;
  dl: number;
  fl: number;
  flLevel: string;
  playMaxbr: number;
  playMaxBrLevel: string;
  downloadMaxbr: number;
  downloadMaxBrLevel: string;
  maxbr: number;
  maxBrLevel: string;
  plLevel: string;
  dlLevel: string;
  freeTrialPrivilege?: NeteaseFreeTrialPrivilege;
  chargeInfoList?: NeteaseChargeInfo[];
}

/**
 */
export interface NeteaseSong {
  id: number;
  name: string;
  tns?: string[];
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  al?: NeteaseAlbumLite;
  album?: NeteaseAlbumLite;
  dt?: number;
  duration?: number;
  alia?: string[];
  alias?: string[];
  h?: NeteaseQuality | null;
  m?: NeteaseQuality | null;
  l?: NeteaseQuality | null;
  sq?: NeteaseQuality | null;
  hr?: NeteaseQuality | null;
  fee?: TrackFee;
  pop?: number;
  mv?: number;
  copyright?: number;
  cd?: string;
  no?: number;
  mark?: number;
  publishTime?: number;
  privilege?: NeteasePrivilege;
  pc?: NeteasePrivateCloud | null;
}

export interface NeteasePrivateCloud {
  fn?: string;
  md5?: string;
  br?: number;
  ar?: string;
  alb?: string;
  sn?: string;
  cid?: string;
  cf?: number;
  vd?: number;
  st?: number;
}

export type PersonalFmMode = "DEFAULT" | "FAMILIAR" | "EXPLORE" | "SCENE_RCMD" | "PUZZLE_MODE_RCMD";

export type PersonalFmSubMode =
  | "EXERCISE"
  | "FOCUS"
  | "NIGHT_EMO"
  | "SLEEP_HELP"
  | "RELAX"
  | "CHEERFUL"
  | "LYRICAL"
  | "CURE"
  | "SWEET"
  | "RHYTHM_BLUES"
  | "RAINY"
  | "GAMES"
  | "RAP"
  | "K_POP"
  | "ORIGINAL_MUSICIAL"
  | "ELECTRONIC"
  | "COMMUTE"
  | "TAKE_SHOWER"
  | "COFFEE_SHOP"
  | "ROCK"
  | "INSPIRATIONAL"
  | "CHINESE"
  | "ENGLISH"
  | "YUEYU"
  | "MANYAO"
  | "JINGDIAN"
  | "LIGHT"
  | "GUOFENG"
  | "FOLK"
  | "ACG"
  | "GUDIAN"
  | "JAZZ"
  | "JAPANESE"
  | "GLOBAL"
  | "FRANCH"
  | "BLUE"
  | "DANCE"
  | "LATIN"
  | "PUNK"
  | "COUNTRY"
  | "MUSICAL"
  | "YINGSHI";

export interface PersonalFmOptions {
  mode?: PersonalFmMode;
  submode?: PersonalFmSubMode;
  limit?: number;
}
