// Credenciales de Google: las mismas de AudioGuía (proyecto "audioguia"
// en Google Cloud). Funcionan aquí porque esta app vive en el mismo
// origen, https://carloszevallostrigoso.github.io. Si la clave de API
// está restringida a la ruta /reproductor/*, hay que añadir
// https://carloszevallostrigoso.github.io/audioedipo/* en la consola.
const DRIVE_CONFIG = {
    API_KEY: 'AIzaSyDBFsYwSu0qTg12H1dbD3tkeIIYOs9iMD8',
    CLIENT_ID: '350579436375-s50ve5lkhvveqc0t4suu3m3q4clp98am.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
};
