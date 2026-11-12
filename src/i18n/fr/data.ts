/** Catalog metadata, sensor sources, generators, store and service messages. */
const data: Record<string, string> = {
  // Shaders (src/services/catalog.ts)
  'Spherical Wave': 'Onde sphérique',
  'Radial wave from the effect origin, shell at radius': 'Onde radiale depuis l’origine de l’effet, coque au rayon',
  'Plasma Field': 'Champ plasma',
  'Trigonometric 3D interference field over X, Y, Z': 'Champ d’interférences 3D trigonométrique sur X, Y, Z',
  'Laser Plane': 'Plan laser',
  'Light plane sweeping the X axis': 'Plan lumineux balayant l’axe X',
  'Height Spectrum': 'Spectre en hauteur',
  'Hue gradient indexed on LED height Y': 'Dégradé de teinte indexé sur la hauteur Y des LEDs',

  // Palettes
  Spectrum: 'Spectre',
  Fire: 'Feu',
  Ocean: 'Océan',
  Forest: 'Forêt',
  Sunset: 'Coucher de soleil',
  Ice: 'Glace',

  // Sensor kinds and hardware
  Gyro: 'Gyroscope',
  'I2S mic (INMP441)': 'Micro I2S (INMP441)',
  'UART GPS (NEO-M8N)': 'GPS UART (NEO-M8N)',
  'Digital input': 'Entrée numérique',

  // Simulator scenarios
  'Electro (4/4)': 'Électro (4/4)',
  'Ambient pad': 'Nappe ambient',
  Speech: 'Voix parlée',
  'Highway drive': 'Autoroute',
  'City stop & go': 'Ville, arrêts fréquents',
  'Pendulum sway': 'Balancement pendulaire',

  // Modulation targets
  'Sphere Radius': 'Rayon sphère',
  '3D influence radius': 'Rayon d’influence 3D',
  'Time Frequency': 'Fréq. temporelle',
  'Shader speed': 'Vitesse du shader',
  'Chroma Shift': 'Décalage chroma',
  'Hue rotation': 'Rotation de teinte',
  'Strobe Override': 'Forçage strobe',
  'Flash above 50%': 'Flash au-delà de 50 %',
  'Master Bright.': 'Luminosité gén.',
  'Output gain': 'Gain de sortie',
  'Origin Y': 'Origine Y',
  'Effect height': 'Hauteur de l’effet',
  'Local Intensity': 'Intensité locale',
  'Per-LED gain near sensor': 'Gain par LED près du capteur',
  'Local Wave': 'Onde locale',
  'Ring from sensor on onset': 'Anneau émis par le capteur à l’attaque',

  // Generators (src/services/generators.ts)
  'Periodic wave, free-running in Hz or locked to the effect tempo.': 'Onde périodique, libre en Hz ou calée sur le tempo de l’effet.',
  Envelope: 'Enveloppe',
  'ADSR triggered when a channel rises above a threshold.': 'ADSR déclenchée quand un canal dépasse un seuil.',
  'Manual knob, also on the Live Pad. Patch it to several routes at once.': 'Potentiomètre manuel, aussi sur le Live Pad. Peut alimenter plusieurs routes à la fois.',
  'OSC In': 'Entrée OSC',
  'Value received over OSC (UDP) at an address; use Learn to capture it.': 'Valeur reçue en OSC (UDP) sur une adresse ; « Apprendre » permet de la capturer.',
  'MIDI In': 'Entrée MIDI',
  'Knob, fader, pad or pitch bend from any connected MIDI port; use Learn to capture it.':
    'Potentiomètre, fader, pad ou pitch bend de tout port MIDI connecté ; « Apprendre » permet de le capturer.',

  // Sensor sources and channels (src/services/sensors.ts)
  Pressed: 'Appui',
  Pitch: 'Tangage',
  Simulator: 'Simulateur',
  'Synthetic signals generated locally: musical spectra, driving profiles, IMU sway, or manual values.':
    'Signaux synthétiques générés localement : spectres musicaux, profils de conduite, balancement IMU ou valeurs manuelles.',
  'Default audio input of this computer, analyzed with a 4096-point FFT. The system asks for permission the first time.':
    'Entrée audio par défaut de cet ordinateur, analysée par une FFT sur 4096 points. Le système demande l’autorisation la première fois.',
  'WLED audio sync': 'Synchro audio WLED',
  'Spectrum sent by a WLED controller with a microphone (Sound Reactive, Sync: Send). Multicast 239.0.0.1:11988, sync format v2.':
    'Spectre envoyé par un contrôleur WLED équipé d’un micro (Sound Reactive, Sync: Send). Multicast 239.0.0.1:11988, format de synchro v2.',
  "Values in the channel unit, sent over OSC (UDP 9000) by the sensor's ESP32 or any OSC app, one address per channel.":
    'Valeurs dans l’unité du canal, envoyées en OSC (UDP 9000) par l’ESP32 du capteur ou toute app OSC, une adresse par canal.',
  'Requesting microphone access…': 'Demande d’accès au microphone…',
  'No audio capture API in this webview.': 'Aucune API de capture audio dans cette webview.',
  'Live: {label}': 'En direct : {label}',
  'default input': 'entrée par défaut',
  'Microphone unavailable: {error}': 'Microphone indisponible : {error}',
  'Waiting for WLED audio sync packets on 239.0.0.1:11988…': 'En attente des paquets de synchro audio WLED sur 239.0.0.1:11988…',
  'Live: {age} ms old': 'En direct : reçu il y a {age} ms',
  'Receiving on UDP {port}': 'Réception sur UDP {port}',
  'Listening on UDP {port}, nothing received yet': 'Écoute sur UDP {port}, rien reçu pour l’instant',

  // Desktop bridge (src/services/tauriBridge.ts)
  'Needs the desktop app (browsers cannot listen on UDP).': 'Nécessite l’app de bureau (un navigateur ne peut pas écouter en UDP).',

  // Project files (src/services/project.ts)
  'Not a JSON file.': 'Ce n’est pas un fichier JSON.',
  'Not a VOXEL // STUDIO project.': 'Ce n’est pas un projet VOXEL // STUDIO.',
  'Project version {version} is newer than this app supports ({supported}).':
    'La version {version} du projet est plus récente que celle prise en charge par cette app ({supported}).',
  'Project is missing strips, devices, routes or sensors.': 'Il manque au projet les segments, contrôleurs, routes ou capteurs.',
  'Invalid LED segment "{name}".': 'Segment LED « {name} » invalide.',
  'Invalid sensor "{name}".': 'Capteur « {name} » invalide.',
  'Project effect parameters are invalid.': 'Les paramètres d’effet du projet sont invalides.',
  'Unknown shader "{name}".': 'Shader « {name} » inconnu.',
  'Invalid generator "{name}".': 'Générateur « {name} » invalide.',
  Untitled: 'Sans titre',

  // Point import (src/services/mappingIO.ts)
  'The file is empty.': 'Le fichier est vide.',
  'No x, y, z values found. Expected three numeric columns or a header with x, y, z.':
    'Aucune valeur x, y, z trouvée. Attendu : trois colonnes numériques ou un en-tête avec x, y, z.',

  // Store default names (src/state/useVoxelStore.ts)
  '{name} copy': '{name} (copie)',
  'Band {n}': 'Bande {n}',
  Mid: 'Médium',
  High: 'Aigu',
};

export default data;
