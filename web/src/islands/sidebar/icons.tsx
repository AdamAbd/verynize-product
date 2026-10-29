// Layer type icons for the layer tree. Glyphs come from lucide or the shared set in @/components/icons.
import { Circle, Frame, Image as ImageIcon, LayoutGrid, Square, Star, Type, type LucideIcon } from "lucide-react";
import { ShaderIcon, StackColumnIcon, StackRowIcon, type IconProps } from "@/components/icons";
import type { ComponentType } from "react";

const byType: Record<string, LucideIcon | ComponentType<IconProps>> = {
  text: Type,
  rectangle: Square,
  image: ImageIcon,
  shader: ShaderIcon,
  icon: Star,
};

/** Row icon for a layer; size comes from `className` (rows use `size-4`). */
export function LayerTypeIcon({
  node,
  className,
}: {
  node: { type: string; layout?: unknown; direction?: unknown; ellipse?: unknown };
  className?: string;
}) {
  if (node.type === "frame") {
    if (node.layout === "flex") {
      const Stack = node.direction === "column" ? StackColumnIcon : StackRowIcon;
      return <Stack className={className} />;
    }
    if (node.layout === "grid") return <LayoutGrid className={className} />;
    return <Frame className={className} />;
  }
  if (node.ellipse === true && node.type !== "text") return <Circle className={className} />;
  const Icon = byType[node.type] ?? Square;
  return <Icon className={className} />;
}
