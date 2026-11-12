/** 3D viewport overlays, scanner, Live Pad. */
const stage: Record<string, string> = {
  // 3D viewport
  'Drag orbit · Shift/Right drag pan · Wheel zoom · Drag handles to move (Alt vertical, Cmd grid) · F focus':
    'Glisser : orbite · Maj/clic droit : panoramique · Molette : zoom · Glisser les poignées pour déplacer (Alt vertical, Cmd grille) · F : cadrer',
  Room: 'Pièce',
  Sphere: 'Sphère',
  Persp: 'Persp',
  Top: 'Dessus',
  Front: 'Face',
  Side: 'Côté',
  'Frame the selection (F)': 'Cadrer la sélection (F)',
  Focus: 'Cadrer',

  // Camera scanner
  'Camera A · 0°': 'Caméra A · 0°',
  'Camera B · 45°': 'Caméra B · 45°',
  'GRAY BIT {bit}/{total}  ·  FRAME {frame}': 'BIT GRAY {bit}/{total}  ·  IMAGE {frame}',
  'Optical Auto-Calibration': 'Auto-calibration optique',
  '10-bit reflected Gray code · stereo triangulation': 'code de Gray réfléchi 10 bits · triangulation stéréo',
  'Simulated camera feed': 'Flux caméra simulé',
  'Gray code (b10…b1)': 'Code de Gray (b10…b1)',
  Decoded: 'Décodé',
  Capture: 'Capture',
  'Project pattern on LEDs': 'Projeter le motif sur les LEDs',
  'Drives the physical LEDs with the current Gray-code bit': 'Pilote les LEDs physiques avec le bit de code de Gray courant',
  Pause: 'Pause',
  'Sequence done': 'Séquence terminée',
  'Run sequence': 'Lancer la séquence',
  'Reset this camera': 'Réinitialiser cette caméra',
  captured: 'capturés',
  'in frame': 'dans le cadre',
  Triangulation: 'Triangulation',
  'Cam {id} decoded': 'Cam {id} décodées',
  Triangulated: 'Triangulées',
  'Mean error': 'Erreur moyenne',
  'RMS error': 'Erreur RMS',
  'P95 error': 'Erreur P95',
  'Max error': 'Erreur max',
  'Capture all 10 bits on both cameras to decode LED IDs and triangulate 3D positions.':
    'Capturer les 10 bits sur les deux caméras pour décoder les ID des LEDs et trianguler les positions 3D.',
  'Centroid noise σ = {noise} px. Rays are back-projected from each camera and intersected at the midpoint of their common perpendicular; error is measured against the mapped layout.':
    'Bruit de centroïde σ = {noise} px. Les rayons sont rétroprojetés depuis chaque caméra et intersectés au milieu de leur perpendiculaire commune ; l’erreur est mesurée par rapport à la disposition mappée.',

  // Live Pad
  Pulse: 'Pulsation',
  Plasma: 'Plasma',
  Laser: 'Laser',
  Ambient: 'Ambiance',
  'HOLD STROBE': 'MAINTENIR STROBE',
  'Height Y': 'Hauteur Y',
  'Live Control Pad': 'Pad de contrôle live',
  'Touch surface preview. Drives the same state as the Studio viewport.': 'Aperçu de la surface tactile. Pilote le même état que la vue 3D du Studio.',
  Tablet: 'Tablette',
  Phone: 'Téléphone',
};

export default stage;
