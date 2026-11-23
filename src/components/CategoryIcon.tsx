import React from 'react';
import {
  Carrot,
  Cookie,
  CupSoda,
  Droplets,
  Drumstick,
  Milk,
  Package,
  Sparkles,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';
import { FoodCategory } from '../types/kitchen';

interface CategoryIconProps {
  category: FoodCategory;
  className?: string;
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({
  category,
  className = 'w-4 h-4',
}) => {
  switch (category) {
    case 'protein':
      return <Drumstick className={className} />;
    case 'dairy':
      return <Milk className={className} />;
    case 'produce':
      return <Carrot className={className} />;
    case 'beverages':
      return <CupSoda className={className} />;
    case 'grains':
      return <Wheat className={className} />;
    case 'condiments':
      return <Droplets className={className} />;
    case 'spices':
      return <Sparkles className={className} />;
    case 'pantry_staple':
      return <Package className={className} />;
    case 'snacks':
      return <Cookie className={className} />;
    case 'prepared':
      return <UtensilsCrossed className={className} />;
    default:
      return <Package className={className} />;
  }
};
