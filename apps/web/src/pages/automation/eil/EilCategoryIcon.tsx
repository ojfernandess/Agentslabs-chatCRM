import {
  Briefcase,
  Building,
  Building2,
  Car,
  Cloud,
  CreditCard,
  GraduationCap,
  Headphones,
  HeartPulse,
  Hotel,
  Landmark,
  Plane,
  Scale,
  Shield,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Hotel,
  ShoppingCart,
  Headphones,
  HeartPulse,
  Building2,
  GraduationCap,
  Landmark,
  CreditCard,
  UtensilsCrossed,
  Briefcase,
  Cloud,
  Users,
  TrendingUp,
  Truck,
  Car,
  Plane,
  Building,
  Shield,
  Scale,
  Sparkles,
};

export function EilCategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Sparkles;
  return <Icon className={className} />;
}
