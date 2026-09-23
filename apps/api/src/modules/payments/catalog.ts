import type { ProductDto } from "@thoroughline/contracts";

export interface Product extends ProductDto {
  /** Purchasable at most once per user. */
  oncePerUser?: boolean;
}

/**
 * Digital products sold for Telegram Stars. Gems buy cosmetics, information and convenience —
 * never credits, horses with competitive advantage, race entries or wins (anti pay-to-win).
 */
export const PRODUCTS: readonly Product[] = [
  {
    id: "GEMS_100",
    title: "Pouch of Gems",
    description: "100 Racing Gems",
    priceStars: 50,
    grants: { gems: 100 },
  },
  {
    id: "GEMS_550",
    title: "Chest of Gems",
    description: "550 Racing Gems (+10%)",
    priceStars: 250,
    grants: { gems: 550 },
  },
  {
    id: "GEMS_1200",
    title: "Vault of Gems",
    description: "1200 Racing Gems (+20%)",
    priceStars: 500,
    grants: { gems: 1200 },
  },
  {
    id: "ROOKIE_PACK",
    title: "Rookie Owner Pack",
    description: "300 Racing Gems — one per owner",
    priceStars: 100,
    grants: { gems: 300 },
    oncePerUser: true,
  },
];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);
