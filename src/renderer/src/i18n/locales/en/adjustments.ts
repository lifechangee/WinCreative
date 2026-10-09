// adjustments module strings (en). Keys: 'adjustments.<area>.<name>'.
const dict: Record<string, string> = {
  'adjustments.ui.layerLocked': 'Layer is locked',

  'adjustments.ui.layerHidden': 'Layer is hidden',

  'adjustments.ui.limit.frame': 'Limited to the frame',
  'adjustments.ui.limit.view': 'Limited to the visible area',
  'adjustments.ui.limit.viewAll': 'Preview: work area, Apply: whole layer',
  'adjustments.ui.limit.tip': 'On an infinite canvas heavy filters work on the frame, or on the visible area when there is no frame',
  'adjustments.ui.nothingToApply': 'Nothing to apply',

  'adjustments.ui.layer': 'Layer',

  'adjustments.ui.pencil': 'Pencil',

  'adjustments.ui.undo': 'Undo',

  'adjustments.ui.reset': 'Reset',

  'adjustments.ui.preview': 'Preview',

  'adjustments.ui.previewTip': 'Toggle before/after',

  'adjustments.ui.cancel': 'Cancel',

  'adjustments.ui.apply': 'Apply',

  'adjustments.ui.dragTip': 'Drag left/right on the canvas to adjust',

  'adjustments.ui.paintBrushTip': 'Paint the effect with the current brush; eraser removes',

  'adjustments.ui.editInPanel': 'Edit in panel',

  'adjustments.ui.paintToClone': 'Paint to clone',

  'adjustments.ui.setSourceTip': 'Alt+click: set source',

  'adjustments.ui.paintWithBrush': 'Paint with brush',

  'adjustments.ui.liquifyHint': 'Drag on the canvas. Twirl, Pinch, Expand, Crystals and Reconstruct keep working while you hold. Reset clears all distortion.',

  'adjustments.ui.placePoint': 'Place point on canvas',

  'adjustments.ui.center': 'Center',

  'adjustments.ui.pointTip': 'Tip: Alt+drag on the canvas also moves the point.',

  'adjustments.ui.pencilHint': 'Pencil: the effect appears where you paint with the current brush (pressure respected). The Eraser tool removes it.',

  'adjustments.ui.dragSliderHint': 'Drag left/right on the canvas to change the highlighted slider.',

  'adjustments.curves.title': 'Curve',

  'adjustments.curves.resetChannel': 'Reset channel',

  'adjustments.curves.resetAll': 'Reset all',

  'adjustments.curves.hint': 'Click to add a point, drag to move, double-click to delete.',

  'adjustments.curves.gamma': 'Gamma',

  'adjustments.curves.red': 'Red',

  'adjustments.curves.green': 'Green',

  'adjustments.curves.blue': 'Blue',

  'adjustments.gradient.title': 'Gradient',

  'adjustments.gradient.stop': 'Stop',

  'adjustments.gradient.delete': 'Delete',

  'adjustments.gradient.reverse': 'Reverse',

  'adjustments.gradient.hint': 'Click the bar to add a stop, drag stops to move them.',

  'adjustments.gradient.library': 'Library',

  'adjustments.clone.setSource': 'Set source',

  'adjustments.clone.resetSource': 'Reset source',

  'adjustments.clone.hint': 'Alt+click sets the source point. Paint with any brush to copy from the source; the eraser restores the original.',

  'adjustments.clone.aligned': 'Aligned (source follows)',

  'adjustments.clone.sourceNotSet': 'Set a clone source first: Alt+click on the canvas',

  'adjustments.adj.color': 'Color',

  'adjustments.adj.octaves': 'Octaves',

  'adjustments.liquify.tool': 'Tool',

  'adjustments.liquify.push': 'Push',

  'adjustments.liquify.twirlRight': 'Twirl Right',

  'adjustments.liquify.twirlLeft': 'Twirl Left',

  'adjustments.liquify.pinch': 'Pinch',

  'adjustments.liquify.expand': 'Expand',

  'adjustments.liquify.crystals': 'Crystals',

  'adjustments.liquify.edge': 'Edge',

  'adjustments.liquify.reconstruct': 'Reconstruct',
  'adjustments.name.hsb': 'Hue, Saturation, Brightness',
  'adjustments.name.colorBalance': 'Color Balance',
  'adjustments.name.curves': 'Curves',
  'adjustments.name.gradientMap': 'Gradient Map',
  'adjustments.name.recolor': 'Recolor',
  'adjustments.name.gaussian': 'Gaussian Blur',
  'adjustments.name.motion': 'Motion Blur',
  'adjustments.name.perspective': 'Perspective Blur',
  'adjustments.name.noise': 'Noise',
  'adjustments.name.sharpen': 'Sharpen',
  'adjustments.name.bloom': 'Bloom',
  'adjustments.name.glitch': 'Glitch',
  'adjustments.name.halftone': 'Halftone',
  'adjustments.name.chromatic': 'Chromatic Aberration',
  'adjustments.name.liquify': 'Liquify',
  'adjustments.name.clone': 'Clone',
  'adjustments.lbl.hue': 'Hue',
  'adjustments.lbl.saturation': 'Saturation',
  'adjustments.lbl.brightness': 'Brightness',
  'adjustments.lbl.range': 'Range',
  'adjustments.lbl.shadows': 'Shadows',
  'adjustments.lbl.midtones': 'Midtones',
  'adjustments.lbl.highlights': 'Highlights',
  'adjustments.lbl.cyanRed': 'Cyan - Red',
  'adjustments.lbl.magentaGreen': 'Magenta - Green',
  'adjustments.lbl.yellowBlue': 'Yellow - Blue',
  'adjustments.lbl.preserveLuminosity': 'Preserve luminosity',
  'adjustments.lbl.intensity': 'Intensity',
  'adjustments.lbl.color': 'Color',
  'adjustments.lbl.radius': 'Radius',
  'adjustments.lbl.amount': 'Amount',
  'adjustments.lbl.direction': 'Direction',
  'adjustments.lbl.backwardOnly': 'Backward only',
  'adjustments.lbl.type': 'Type',
  'adjustments.lbl.positional': 'Positional',
  'adjustments.lbl.directional': 'Directional',
  'adjustments.lbl.focalPoint': 'Focal point',
  'adjustments.lbl.clouds': 'Clouds',
  'adjustments.lbl.billows': 'Billows',
  'adjustments.lbl.ridges': 'Ridges',
  'adjustments.lbl.grain': 'Grain',
  'adjustments.lbl.scale': 'Scale',
  'adjustments.lbl.octaves': 'Octaves',
  'adjustments.lbl.turbulence': 'Turbulence',
  'adjustments.lbl.monochrome': 'Monochrome',
  'adjustments.lbl.seed': 'Seed',
  'adjustments.lbl.transition': 'Transition',
  'adjustments.lbl.size': 'Size',
  'adjustments.lbl.opacity': 'Opacity',
  'adjustments.lbl.burn': 'Burn',
  'adjustments.lbl.artifact': 'Artifact',
  'adjustments.lbl.wave': 'Wave',
  'adjustments.lbl.displace': 'Displace',
  'adjustments.lbl.signal': 'Signal',
  'adjustments.lbl.tear': 'Tear',
  'adjustments.lbl.diverge': 'Diverge',
  'adjustments.lbl.distance': 'Distance',
  'adjustments.lbl.offset': 'Offset',
  'adjustments.lbl.pattern': 'Pattern',
  'adjustments.lbl.fullColor': 'Full Color',
  'adjustments.lbl.screenPrint': 'Screen Print',
  'adjustments.lbl.newspaper': 'Newspaper',
  'adjustments.lbl.dot': 'Dot',
  'adjustments.lbl.line': 'Line',
  'adjustments.lbl.cross': 'Cross',
  'adjustments.lbl.screenAngle': 'Screen angle',
  'adjustments.lbl.perspective': 'Perspective',
  'adjustments.lbl.tool': 'Tool',
  'adjustments.lbl.pressure': 'Pressure',
  'adjustments.lbl.distortion': 'Distortion',
  'adjustments.lbl.momentum': 'Momentum',
  'adjustments.lbl.alignedSourceFollows': 'Aligned (source follows)',
  'adjustments.lbl.push': 'Push',
  'adjustments.lbl.twirlRight': 'Twirl Right',
  'adjustments.lbl.twirlLeft': 'Twirl Left',
  'adjustments.lbl.pinch': 'Pinch',
  'adjustments.lbl.expand': 'Expand',
  'adjustments.lbl.crystals': 'Crystals',
  'adjustments.lbl.edge': 'Edge',
  'adjustments.lbl.reconstruct': 'Reconstruct',
  'adjustments.lbl.blackWhite': 'Black & White',
  'adjustments.lbl.sepia': 'Sepia',
  'adjustments.lbl.sunset': 'Sunset',
  'adjustments.lbl.ocean': 'Ocean',
  'adjustments.lbl.fire': 'Fire',
  'adjustments.lbl.neon': 'Neon',
  'adjustments.lbl.forest': 'Forest',
  'adjustments.lbl.rainbow': 'Rainbow',
  'adjustments.lbl.duotoneTealOrange': 'Duotone Teal-Orange',
  'adjustments.lbl.cyanotype': 'Cyanotype',
  'adjustments.lbl.roseGold': 'Rose Gold',
  'adjustments.lbl.toxic': 'Toxic',
}
export default dict
