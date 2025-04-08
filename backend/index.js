const express = require('express');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pool = new Pool({
    user: 'postgres',
    host: 'localhost', // O el host de tu base de datos en Railway
    database: 'uv_messages',
    password: 'tu_contraseña', // Cambia esto por tu contraseña real
    port: 5432,
});

app.use(express.json());

wss.on('connection', (ws, req) => {
    const username = req.url.split('username=')[1];
    console.log(`${username} conectado vía WebSocket`);
    ws.username = username;
});

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Registro
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *',
            [usernameLower, password]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({ error: 'Usuario ya existe o error en el servidor' });
    }
});

// Inicio de sesión
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'SELECT id, username, profile_pic FROM users WHERE username = $1 AND password = $2',
            [usernameLower, password]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Obtener contactos
app.get('/contacts/:username', async (req, res) => {
    const usernameLower = req.params.username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'SELECT contact FROM contacts WHERE username = $1',
            [usernameLower]
        );
        const contacts = result.rows.map(row => row.contact);
        console.log(`Contactos devueltos para ${usernameLower}:`, contacts); // Log para depuración
        res.json(contacts);
    } catch (err) {
        console.error('Error al obtener contactos:', err);
        res.status(500).json({ error: 'Error al obtener contactos' });
    }
});

// Agregar contacto
app.post('/contacts', async (req, res) => {
    const { username, contact } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    const contactLower = contact.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'INSERT INTO contacts (username, contact) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [usernameLower, contactLower]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(400).json({ error: 'Contacto ya existe o no se pudo añadir' });
        }
    } catch (err) {
        console.error('Error al añadir contacto:', err);
        res.status(500).json({ error: 'Error al añadir contacto' });
    }
});

// Obtener mensajes
app.get('/messages/:sender/:receiver', async (req, res) => {
    const senderLower = req.params.sender.toLowerCase(); // Normalizar a minúsculas
    const receiverLower = req.params.receiver.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1) ORDER BY timestamp',
            [senderLower, receiverLower]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener mensajes:', err);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

// Enviar mensaje
app.post('/messages', async (req, res) => {
    const { sender, receiver, text } = req.body;
    const senderLower = sender.toLowerCase(); // Normalizar a minúsculas
    const receiverLower = receiver.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'INSERT INTO messages (sender, receiver, text) VALUES ($1, $2, $3) RETURNING *',
            [senderLower, receiverLower, text]
        );
        const message = result.rows[0];
        broadcastMessage(message);
        res.json(message);
    } catch (err) {
        console.error('Error al enviar mensaje:', err);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

// Obtener foto de perfil
app.get('/profile-pic/:username', async (req, res) => {
    const usernameLower = req.params.username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'SELECT profile_pic FROM users WHERE username = $1',
            [usernameLower]
        );
        res.json({ profile_pic: result.rows[0]?.profile_pic || null });
    } catch (err) {
        console.error('Error al obtener foto de perfil:', err);
        res.status(500).json({ error: 'Error al obtener foto de perfil' });
    }
});

// Actualizar foto de perfil
app.post('/profile-pic', async (req, res) => {
    const { username, profilePic } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'UPDATE users SET profile_pic = $2 WHERE username = $1 RETURNING *',
            [usernameLower, profilePic]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error al actualizar foto de perfil:', err);
        res.status(500).json({ error: 'Error al actualizar foto de perfil' });
    }
});

// Crear grupo
app.post('/groups', async (req, res) => {
    const { group_name, members, creator, group_pic } = req.body;
    const creatorLower = creator.toLowerCase(); // Normalizar a minúsculas
    const membersLower = members.map(m => m.toLowerCase()); // Normalizar a minúsculas
    try {
        const groupResult = await pool.query(
            'INSERT INTO groups (group_name, creator, group_pic) VALUES ($1, $2, $3) RETURNING *',
            [group_name, creatorLower, group_pic]
        );
        const groupId = groupResult.rows[0].group_id;
        for (const member of [...membersLower, creatorLower]) {
            await pool.query(
                'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [groupId, member]
            );
        }
        res.json(groupResult.rows[0]);
    } catch (err) {
        console.error('Error al crear grupo:', err);
        res.status(500).json({ error: 'Error al crear grupo' });
    }
});

// Obtener grupos
app.get('/groups/:username', async (req, res) => {
    const usernameLower = req.params.username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'SELECT g.group_id, g.group_name, g.group_pic, g.creator FROM groups g JOIN group_members gm ON g.group_id = gm.group_id WHERE gm.username = $1',
            [usernameLower]
        );
        console.log(`Grupos devueltos para ${usernameLower}:`, result.rows); // Log para depuración
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener grupos:', err);
        res.status(500).json({ error: 'Error al obtener grupos' });
    }
});

// Obtener miembros del grupo
app.get('/group-members/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    try {
        const result = await pool.query(
            'SELECT username FROM group_members WHERE group_id = $1',
            [groupId]
        );
        res.json(result.rows.map(row => row.username));
    } catch (err) {
        console.error('Error al obtener miembros del grupo:', err);
        res.status(500).json({ error: 'Error al obtener miembros' });
    }
});

// Enviar mensaje de grupo
app.post('/group_messages', async (req, res) => {
    const { group_id, sender, text } = req.body;
    const senderLower = sender.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'INSERT INTO group_messages (group_id, sender, text) VALUES ($1, $2, $3) RETURNING *',
            [group_id, senderLower, text]
        );
        const message = result.rows[0];
        broadcastMessage(message);
        res.json(message);
    } catch (err) {
        console.error('Error al enviar mensaje de grupo:', err);
        res.status(500).json({ error: 'Error al enviar mensaje de grupo' });
    }
});

// Obtener mensajes de grupo
app.get('/group_messages/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    try {
        const result = await pool.query(
            'SELECT * FROM group_messages WHERE group_id = $1 ORDER BY timestamp',
            [groupId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener mensajes de grupo:', err);
        res.status(500).json({ error: 'Error al obtener mensajes de grupo' });
    }
});

// Actualizar foto del grupo
app.post('/group-pic', async (req, res) => {
    const { group_id, group_pic, username } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'UPDATE groups SET group_pic = $1 WHERE group_id = $2 AND creator = $3 RETURNING *',
            [group_pic, group_id, usernameLower]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(403).json({ error: 'No autorizado o grupo no encontrado' });
        }
    } catch (err) {
        console.error('Error al actualizar foto del grupo:', err);
        res.status(500).json({ error: 'Error al actualizar foto del grupo' });
    }
});

// Actualizar nombre del grupo
app.post('/group-name', async (req, res) => {
    const { group_id, group_name, username } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const result = await pool.query(
            'UPDATE groups SET group_name = $1 WHERE group_id = $2 AND creator = $3 RETURNING *',
            [group_name, group_id, usernameLower]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(403).json({ error: 'No autorizado o grupo no encontrado' });
        }
    } catch (err) {
        console.error('Error al actualizar nombre del grupo:', err);
        res.status(500).json({ error: 'Error al actualizar nombre del grupo' });
    }
});

// Añadir miembro al grupo
app.post('/group-add-member', async (req, res) => {
    const { group_id, username, new_member } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    const newMemberLower = new_member.toLowerCase(); // Normalizar a minúsculas
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND creator = $2',
            [group_id, usernameLower]
        );
        if (checkCreator.rows.length === 0) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        const result = await pool.query(
            'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [group_id, newMemberLower]
        );
        res.json(result.rows[0] || { message: 'Miembro añadido o ya existía' });
    } catch (err) {
        console.error('Error al añadir miembro al grupo:', err);
        res.status(500).json({ error: 'Error al añadir miembro' });
    }
});

// Eliminar miembro del grupo
app.post('/group-remove-member', async (req, res) => {
    const { group_id, username, member_to_remove } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    const memberLower = member_to_remove.toLowerCase(); // Normalizar a minúsculas
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND creator = $2',
            [group_id, usernameLower]
        );
        if (checkCreator.rows.length === 0) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        const result = await pool.query(
            'DELETE FROM group_members WHERE group_id = $1 AND username = $2 RETURNING *',
            [group_id, memberLower]
        );
        if (result.rows.length > 0) {
            res.json({ message: 'Miembro eliminado' });
        } else {
            res.status(404).json({ error: 'Miembro no encontrado' });
        }
    } catch (err) {
        console.error('Error al eliminar miembro del grupo:', err);
        res.status(500).json({ error: 'Error al eliminar miembro' });
    }
});

// Eliminar grupo
app.post('/delete-group', async (req, res) => {
    const { group_id, username } = req.body;
    const usernameLower = username.toLowerCase(); // Normalizar a minúsculas
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND creator = $2',
            [group_id, usernameLower]
        );
        if (checkCreator.rows.length === 0) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        await pool.query('DELETE FROM group_messages WHERE group_id = $1', [group_id]);
        await pool.query('DELETE FROM group_members WHERE group_id = $1', [group_id]);
        await pool.query('DELETE FROM groups WHERE group_id = $1', [group_id]);
        broadcastMessage({ type: 'group_deleted', group_id });
        res.json({ message: 'Grupo eliminado' });
    } catch (err) {
        console.error('Error al eliminar grupo:', err);
        res.status(500).json({ error: 'Error al eliminar grupo' });
    }
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});
