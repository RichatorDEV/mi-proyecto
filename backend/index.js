const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const pool = require('./db'); // Asegúrate de que ./db esté configurado para PostgreSQL

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Configurar CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
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
                contact TEXT NOT NULL,
                UNIQUE (username, contact)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender TEXT NOT NULL,
                receiver TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS groups (
                group_id SERIAL PRIMARY KEY,
                group_name TEXT UNIQUE NOT NULL,
                creator TEXT NOT NULL,
                group_pic TEXT,
                FOREIGN KEY (creator) REFERENCES users(username)
            );

            CREATE TABLE IF NOT EXISTS group_members (
                group_id INTEGER,
                username TEXT,
                PRIMARY KEY (group_id, username),
                FOREIGN KEY (group_id) REFERENCES groups(group_id),
                FOREIGN KEY (username) REFERENCES users(username)
            );

            CREATE TABLE IF NOT EXISTS group_messages (
                id SERIAL PRIMARY KEY,
                group_id INTEGER,
                sender TEXT,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups(group_id),
                FOREIGN KEY (sender) REFERENCES users(username)
            );
        `);
        console.log('Tablas creadas o verificadas con éxito');
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err.message);
    }
}

// Ejecutar al arrancar
initializeDatabase();

// Manejo de WebSockets
const clients = new Map();

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const username = urlParams.get('username');
    if (username) {
        clients.set(username, ws);
        console.log(`Usuario ${username} conectado vía WebSocket`);
    }

    ws.on('close', () => {
        clients.delete(username);
        console.log(`Usuario ${username} desconectado del WebSocket`);
    });

    ws.on('error', (err) => {
        console.error(`Error en WebSocket para ${username}:`, err);
    });
});

function notifyMessage(message) {
    if (message.group_id) {
        pool.query('SELECT username FROM group_members WHERE group_id = $1', [message.group_id])
            .then(result => {
                const members = result.rows.map(row => row.username);
                members.forEach(member => {
                    const clientWs = clients.get(member);
                    if (clientWs && clientWs.readyState === clientWs.OPEN) {
                        clientWs.send(JSON.stringify(message));
                    }
                });
            })
            .catch(err => console.error('Error al obtener miembros del grupo:', err.message));
    } else {
        const receiverWs = clients.get(message.receiver);
        const senderWs = clients.get(message.sender);
        if (receiverWs && receiverWs.readyState === receiverWs.OPEN) {
            receiverWs.send(JSON.stringify(message));
        }
        if (senderWs && senderWs.readyState === senderWs.OPEN && message.sender !== message.receiver) {
            senderWs.send(JSON.stringify(message));
        }
    }
}

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
    console.log('Solicitud para agregar contacto:', { username, contact });
    try {
        const contactExists = await pool.query(
            'SELECT 1 FROM users WHERE username = $1',
            [contact]
        );
        if (contactExists.rows.length === 0) {
            console.log('El contacto no existe:', contact);
            return res.status(400).json({ error: 'El contacto no existe' });
        }
        const result = await pool.query(
            'INSERT INTO contacts (username, contact) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [username, contact]
        );
        console.log('Contacto agregado:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en /contacts:', err.message);
        if (err.code === '23505') {
            res.status(400).json({ error: 'El contacto ya está en la lista' });
        } else {
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }
});

// Obtener contactos con paginación
app.get('/contacts/:username', async (req, res) => {
    const { username } = req.params;
    const { page = 1, limit = 10 } = req.query;
    console.log('GET /contacts/:username - Solicitando contactos para:', username, 'Página:', page, 'Límite:', limit);

    try {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            'SELECT contact FROM contacts WHERE username = $1 ORDER BY contact LIMIT $2 OFFSET $3',
            [username, limit, offset]
        );
        const contacts = result.rows.map(row => row.contact);
        console.log('Contactos encontrados en la base de datos:', contacts);
        
        // Si no hay contactos, devolver un array vacío pero con logs claros
        if (contacts.length === 0) {
            console.log(`No se encontraron contactos para ${username} en la página ${page}`);
        }
        
        res.json(contacts);
    } catch (err) {
        console.error('Error en /contacts/:username:', err.message);
        res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
    }
});

// Enviar mensaje (con adición automática de contacto)
app.post('/messages', async (req, res) => {
    const { sender, receiver, text } = req.body;
    try {
        const contactCheck = await pool.query(
            'SELECT 1 FROM contacts WHERE username = $1 AND contact = $2',
            [receiver, sender]
        );
        if (contactCheck.rows.length === 0) {
            await pool.query(
                'INSERT INTO contacts (username, contact) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [receiver, sender]
            );
            console.log(`Contacto ${sender} añadido automáticamente a ${receiver}`);
        }

        const result = await pool.query(
            'INSERT INTO messages (sender, receiver, text) VALUES ($1, $2, $3) RETURNING *',
            [sender, receiver, text]
        );
        const message = result.rows[0];
        notifyMessage(message);
        res.json(message);
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

// Crear un grupo
app.post('/groups', async (req, res) => {
    const { group_name, members, creator, group_pic } = req.body;
    if (!group_pic) {
        return res.status(400).json({ error: 'La foto del grupo es obligatoria' });
    }
    try {
        const groupResult = await pool.query(
            'INSERT INTO groups (group_name, creator, group_pic) VALUES ($1, $2, $3) RETURNING group_id',
            [group_name, creator, group_pic]
        );
        const group_id = groupResult.rows[0].group_id;

        const allMembers = [...members, creator];
        for (const member of allMembers) {
            await pool.query(
                'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [group_id, member]
            );
        }

        res.json({ group_id, group_name });
    } catch (err) {
        console.error('Error en /groups:', err.message);
        if (err.code === '23505') {
            res.status(400).json({ error: 'El nombre del grupo ya existe' });
        } else {
            res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
        }
    }
});

// Obtener grupos de un usuario
app.get('/groups/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const result = await pool.query(
            'SELECT g.group_id, g.group_name, g.group_pic, g.creator FROM groups g JOIN group_members gm ON g.group_id = gm.group_id WHERE gm.username = $1',
            [username]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /groups/:username:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Enviar mensaje a un grupo
app.post('/group_messages', async (req, res) => {
    const { group_id, sender, text } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO group_messages (group_id, sender, text) VALUES ($1, $2, $3) RETURNING *',
            [group_id, sender, text]
        );
        const message = result.rows[0];
        notifyMessage(message);
        res.json(message);
    } catch (err) {
        console.error('Error en /group_messages:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener mensajes de un grupo
app.get('/group_messages/:group_id', async (req, res) => {
    const { group_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM group_messages WHERE group_id = $1 ORDER BY timestamp',
            [group_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /group_messages/:group_id:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar foto del grupo
app.post('/group-pic', async (req, res) => {
    const { group_id, group_pic, username } = req.body;
    console.log('Datos recibidos en /group-pic:', { 
        group_id, 
        group_pic_length: group_pic ? group_pic.length : 'null', 
        username 
    });
    try {
        const creatorCheck = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1',
            [group_id]
        );
        if (creatorCheck.rows.length === 0) {
            console.log('Grupo no encontrado para group_id:', group_id);
            return res.status(404).json({ error: 'Grupo no encontrado' });
        }
        if (creatorCheck.rows[0].creator !== username) {
            console.log('Usuario no autorizado:', username, 'Creador:', creatorCheck.rows[0].creator);
            return res.status(403).json({ error: 'Solo el creador puede modificar el grupo' });
        }
        const result = await pool.query(
            'UPDATE groups SET group_pic = $1 WHERE group_id = $2 RETURNING *',
            [group_pic, group_id]
        );
        console.log('Foto actualizada con éxito:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en /group-pic:', err.message);
        res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
    }
});

// Actualizar nombre del grupo
app.post('/group-name', async (req, res) => {
    const { group_id, group_name, username } = req.body;
    try {
        const creatorCheck = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1',
            [group_id]
        );
        if (creatorCheck.rows[0].creator !== username) {
            return res.status(403).json({ error: 'Solo el creador puede modificar el grupo' });
        }
        const result = await pool.query(
            'UPDATE groups SET group_name = $1 WHERE group_id = $2 RETURNING *',
            [group_name, group_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en /group-name:', err.message);
        if (err.code === '23505') {
            res.status(400).json({ error: 'El nombre del grupo ya existe' });
        } else {
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }
});

// Añadir miembro al grupo
app.post('/group-add-member', async (req, res) => {
    const { group_id, username, new_member } = req.body;
    try {
        const creatorCheck = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1',
            [group_id]
        );
        if (creatorCheck.rows[0].creator !== username) {
            return res.status(403).json({ error: 'Solo el creador puede modificar el grupo' });
        }
        const memberExists = await pool.query(
            'SELECT 1 FROM users WHERE username = $1',
            [new_member]
        );
        if (memberExists.rows.length === 0) {
            return res.status(400).json({ error: 'El usuario no existe' });
        }
        await pool.query(
            'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [group_id, new_member]
        );
        res.json({ message: 'Miembro añadido' });
    } catch (err) {
        console.error('Error en /group-add-member:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Expulsar miembro del grupo
app.post('/group-remove-member', async (req, res) => {
    const { group_id, username, member_to_remove } = req.body;
    try {
        const creatorCheck = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1',
            [group_id]
        );
        if (creatorCheck.rows[0].creator !== username) {
            return res.status(403).json({ error: 'Solo el creador puede modificar el grupo' });
        }
        if (member_to_remove === creatorCheck.rows[0].creator) {
            return res.status(400).json({ error: 'No puedes expulsarte a ti mismo como creador' });
        }
        await pool.query(
            'DELETE FROM group_members WHERE group_id = $1 AND username = $2',
            [group_id, member_to_remove]
        );
        res.json({ message: 'Miembro expulsado' });
    } catch (err) {
        console.error('Error en /group-remove-member:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener miembros del grupo
app.get('/group-members/:group_id', async (req, res) => {
    const { group_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT username FROM group_members WHERE group_id = $1',
            [group_id]
        );
        res.json(result.rows.map(row => row.username));
    } catch (err) {
        console.error('Error en /group-members/:group_id:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar un grupo
app.post('/delete-group', async (req, res) => {
    const { group_id, username } = req.body;
    try {
        const creatorCheck = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1',
            [group_id]
        );
        if (creatorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Grupo no encontrado' });
        }
        if (creatorCheck.rows[0].creator !== username) {
            return res.status(403).json({ error: 'Solo el creador puede eliminar el grupo' });
        }

        const membersResult = await pool.query(
            'SELECT username FROM group_members WHERE group_id = $1',
            [group_id]
        );
        const members = membersResult.rows.map(row => row.username);

        await pool.query(
            'DELETE FROM group_messages WHERE group_id = $1',
            [group_id]
        );
        await pool.query(
            'DELETE FROM group_members WHERE group_id = $1',
            [group_id]
        );
        await pool.query(
            'DELETE FROM groups WHERE group_id = $1',
            [group_id]
        );

        const notification = { type: 'group_deleted', group_id };
        members.forEach(member => {
            const clientWs = clients.get(member);
            if (clientWs && clientWs.readyState === clientWs.OPEN) {
                clientWs.send(JSON.stringify(notification));
            }
        });

        res.json({ message: 'Grupo eliminado con éxito' });
    } catch (err) {
        console.error('Error en /delete-group:', err.message);
        res.status(500).json({ error: 'Error interno del servidor: ' + err.message });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
