// Shared theme-to-CSS-variables logic for every proposal page template (SignCrafters,
// NexusLeds, the default Luminus layout, and the Terms page). Previously each template
// duplicated this computed independently — Terms page's copy was simply missing, which is
// exactly how it ended up frozen on stale colors while the others tracked live changes.
// One shared source now, so a fix or a new effect (like the corner glow) reaches every
// template at once instead of needing N coordinated edits.
import { computed } from 'vue'

export const hexToRgba = (hex, alpha) => {
  if (!hex) return 'transparent'
  const color = parseInt(hex.substring(1), 16)
  if (isNaN(color)) return 'transparent'
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// The dual-corner radial-gradient glow, tinted by the theme's own accent color — proven
// pattern (previously only on one unused hidden preset), now applied to every theme rather
// than hand-baked per class, so it always matches whatever accent color is actually active.
const glowBackgroundImage = (glowColor, glowIntensity) => {
  const primary = hexToRgba(glowColor, Math.min(glowIntensity, 0.6))
  const soft = hexToRgba(glowColor, Math.min(glowIntensity * 0.3, 0.2))
  return `radial-gradient(circle at 100% 0%, ${primary} 0%, ${soft} 25%, transparent 50%), ` +
         `radial-gradient(circle at 0% 100%, ${primary} 0%, ${soft} 25%, transparent 50%)`
}

// `settingsRef` is a ref (or computed) so this stays reactive to live edits. Applied
// unconditionally — whether the active theme is a named preset or "custom" — rather than
// only for 'theme-custom' as earlier versions of this logic did per-template: a preset
// button sets these exact settings fields too (see EditorSidebar's applyThemePreset), so
// gating on the theme name just meant preset colors came from stale, easy-to-forget
// per-file static CSS instead of the one place that's actually kept up to date.
export function useProposalTheme(settingsRef) {
  return computed(() => {
    const settings = settingsRef.value
    if (!settings) return {}
    const glowOn = settings.glowEnabled !== false // default on for older saved proposals with no such field yet
    return {
      '--page-bg': settings.themeBg,
      '--text-main': settings.themeText,
      '--text-muted': hexToRgba(settings.themeText, 0.6),
      '--card-bg': hexToRgba(settings.themeText, 0.05),
      '--border-color': hexToRgba(settings.themeText, 0.15),
      '--text-accent': settings.accentColor,
      '--text-accent-glow': glowOn ? hexToRgba(settings.glowColor, settings.glowIntensity) : 'transparent',
      '--glow-color': settings.glowColor,
      'background-color': settings.themeBg,
      'background-image': glowOn ? glowBackgroundImage(settings.glowColor, settings.glowIntensity) : 'none'
    }
  })
}
