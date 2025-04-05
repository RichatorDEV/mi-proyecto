const express = require('express');
const pool = require('./db');
const app = express();

app.use(express.json());

// Configurar CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Inicializar las tablas
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                profile_pic TEXT
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                contact TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT NOT NULL,
                receiver TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Tablas creadas o verificadas con éxito');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err.message);
    }
}

// Ejecutar al arrancar
initializeDatabase();

// Registro de usuario
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *',
            [username, password]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            res.status(400).json({ error: 'El usuario ya existe' });
        } else {
            console.error('Error en /register:', err.message);
            res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
        }
    }
});

// Inicio de sesión
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT id, username, profile_pic FROM users WHERE username = $1 AND password = $2',
            [username, password]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (err) {
        console.error('Error en /login:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar foto de perfil
app.post('/profile-pic', async (req, res) => {
    const { username, profilePic } = req.body;
    console.log('Datos recibidos en /profile-pic:', { username, profilePic: profilePic ? 'base64 data' : 'null' });
    try {
        const result = await pool.query(
            'UPDATE users SET profile_pic = $1 WHERE username = $2 RETURNING *',
            [profilePic, username]
        );
        if (result.rows.length > 0) {
            console.log('Foto de perfil actualizada para:', username);
            res.json(result.rows[0]);
        } else {
            console.log('Usuario no encontrado:', username);
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (err) {
        console.error('Error en /profile-pic:', err.message);
        res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
    }
});

// Obtener foto de perfil de un usuario
app.get('/profile-pic/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const result = await pool.query(
            'SELECT profile_pic FROM users WHERE username = $1',
            [username]
        );
        if (result.rows.length > 0) {
            res.json({ profile_pic: result.rows[0].profile_pic });
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (err) {
        console.error('Error en /profile-pic/:username:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Agregar contacto
app.post('/contacts', async (req, res) => {
    const { username, contact } = req.body;
    try {
        const contactExists = await pool.query(
            'SELECT 1 FROM users WHERE username = $1',
            [contact]
        );
        if (contactExists.rows.length === 0) {
            return res.status(400).json({ error: 'El contacto no existe' });
        }
        const result = await pool.query(
            'INSERT INTO contacts (username, contact) VALUES ($1, $2) RETURNING *',
            [username, contact]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en /contacts:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener contactos
app.get('/contacts/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const result = await pool.query(
            'SELECT contact FROM contacts WHERE username = $1',
            [username]
        );
        res.json(result.rows.map(row => row.contact));
    } catch (err) {
        console.error('Error en /contacts/:username:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Enviar mensaje
app.post('/messages', async (req, res) => {
    const { sender, receiver, text } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO messages (sender, receiver, text) VALUES ($1, $2, $3) RETURNING *',
            [sender, receiver, text]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en /messages:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener mensajes
app.get('/messages/:sender/:receiver', async (req, res) => {
    const { sender, receiver } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1) ORDER BY timestamp',
            [sender, receiver]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /messages/:sender/:receiver:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
