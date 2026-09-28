import { Point, Player, Territory } from "./core";
export type MapProps = {
  territories: Territory[];
  players: Player[];
  points: Point[];
  center: Point | null;
  focus: number;
};
