const express = require('express');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pool = new Pool({
    user: 'postgres',
    host: 'localhost', // Cambia a tu host en Railway si aplica
    database: 'uv_messages',
    password: 'tu_contraseña', // Cambia por tu contraseña real
    port: 5432,
});

app.use(express.json());

wss.on('connection', (ws, req) => {
    const username = req.url.split('username=')[1]; // Sin .toLowerCase(), respetamos el original
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
    console.log('Intento de registro:', { username, password });
    try {
        const checkUser = await pool.query(
            'SELECT username FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }
        const result = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, profile_pic',
            [username, password] // Guardamos tal como se ingresa
        );
        console.log('Usuario registrado:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({ error: 'Error en el servidor al registrar' });
    }
});

// Inicio de sesión
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Intento de login:', { username, password });
    try {
        const result = await pool.query(
            'SELECT id, username, profile_pic FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
            [username, password]
        );
        if (result.rows.length > 0) {
            console.log('Login exitoso:', result.rows[0]);
            res.json(result.rows[0]);
        } else {
            console.log('Credenciales inválidas para:', username);
            res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
    }
});

// Obtener contactos
app.get('/contacts/:username', async (req, res) => {
    const username = req.params.username; // Sin .toLowerCase()
    console.log('Solicitando contactos para:', username);
    try {
        const result = await pool.query(
            'SELECT contact FROM contacts WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        const contacts = result.rows.map(row => row.contact);
        console.log(`Contactos devueltos para ${username}:`, contacts);
        res.json(contacts);
    } catch (err) {
        console.error('Error al obtener contactos:', err);
        res.status(500).json({ error: 'Error al obtener contactos' });
    }
});

// Agregar contacto
app.post('/contacts', async (req, res) => {
    const { username, contact } = req.body;
    console.log('Añadiendo contacto:', { username, contact });
    try {
        const result = await pool.query(
            'INSERT INTO contacts (username, contact) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [username, contact] // Guardamos tal como se ingresa
        );
        if (result.rows.length > 0) {
            console.log('Contacto añadido:', result.rows[0]);
            res.json(result.rows[0]);
        } else {
            console.log('Contacto ya existe o no se pudo añadir:', { username, contact });
            res.status(400).json({ error: 'Contacto ya existe o no se pudo añadir' });
        }
    } catch (err) {
        console.error('Error al añadir contacto:', err);
        res.status(500).json({ error: 'Error al añadir contacto' });
    }
});

// Obtener mensajes
app.get('/messages/:sender/:receiver', async (req, res) => {
    const sender = req.params.sender;
    const receiver = req.params.receiver;
    console.log('Solicitando mensajes entre:', { sender, receiver });
    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE (LOWER(sender) = LOWER($1) AND LOWER(receiver) = LOWER($2)) OR (LOWER(sender) = LOWER($2) AND LOWER(receiver) = LOWER($1)) ORDER BY timestamp',
            [sender, receiver]
        );
        console.log('Mensajes devueltos:', result.rows.length);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener mensajes:', err);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

// Enviar mensaje
app.post('/messages', async (req, res) => {
    const { sender, receiver, text } = req.body;
    console.log('Enviando mensaje:', { sender, receiver, text });
    try {
        const result = await pool.query(
            'INSERT INTO messages (sender, receiver, text) VALUES ($1, $2, $3) RETURNING *',
            [sender, receiver, text] // Guardamos tal como se ingresa
        );
        const message = result.rows[0];
        console.log('Mensaje enviado y broadcast:', message);
        broadcastMessage(message);
        res.json(message);
    } catch (err) {
        console.error('Error al enviar mensaje:', err);
        res.status(500).json({ error: 'Error al enviar mensaje' });
    }
});

// Obtener foto de perfil
app.get('/profile-pic/:username', async (req, res) => {
    const username = req.params.username;
    console.log('Solicitando foto de perfil para:', username);
    try {
        const result = await pool.query(
            'SELECT profile_pic FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        const profilePic = result.rows[0]?.profile_pic || null;
        console.log('Foto de perfil devuelta:', profilePic);
        res.json({ profile_pic: profilePic });
    } catch (err) {
        console.error('Error al obtener foto de perfil:', err);
        res.status(500).json({ error: 'Error al obtener foto de perfil' });
    }
});

// Actualizar foto de perfil
app.post('/profile-pic', async (req, res) => {
    const { username, profilePic } = req.body;
    console.log('Actualizando foto de perfil para:', username);
    try {
        const result = await pool.query(
            'UPDATE users SET profile_pic = $2 WHERE LOWER(username) = LOWER($1) RETURNING *',
            [username, profilePic]
        );
        if (result.rows.length > 0) {
            console.log('Foto de perfil actualizada:', result.rows[0]);
            res.json(result.rows[0]);
        } else {
            console.log('Usuario no encontrado:', username);
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (err) {
        console.error('Error al actualizar foto de perfil:', err);
        res.status(500).json({ error: 'Error al actualizar foto de perfil' });
    }
});

// Crear grupo
app.post('/groups', async (req, res) => {
    const { group_name, members, creator, group_pic } = req.body;
    console.log('Creando grupo:', { group_name, creator, members });
    try {
        const groupResult = await pool.query(
            'INSERT INTO groups (group_name, creator, group_pic) VALUES ($1, $2, $3) RETURNING *',
            [group_name, creator, group_pic]
        );
        const groupId = groupResult.rows[0].group_id;
        const allMembers = [...new Set([...members, creator])]; // Evitar duplicados
        for (const member of allMembers) {
            await pool.query(
                'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [groupId, member]
            );
        }
        console.log('Grupo creado:', groupResult.rows[0]);
        res.json(groupResult.rows[0]);
    } catch (err) {
        console.error('Error al crear grupo:', err);
        res.status(500).json({ error: 'Error al crear grupo' });
    }
});

// Obtener grupos
app.get('/groups/:username', async (req, res) => {
    const username = req.params.username;
    console.log('Solicitando grupos para:', username);
    try {
        const result = await pool.query(
            'SELECT g.group_id, g.group_name, g.group_pic, g.creator FROM groups g JOIN group_members gm ON g.group_id = gm.group_id WHERE LOWER(gm.username) = LOWER($1)',
            [username]
        );
        console.log(`Grupos devueltos para ${username}:`, result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener grupos:', err);
        res.status(500).json({ error: 'Error al obtener grupos' });
    }
});

// Obtener miembros del grupo
app.get('/group-members/:groupId', async (req, res) => {
    const groupId = req.params.groupId;
    console.log('Solicitando miembros del grupo:', groupId);
    try {
        const result = await pool.query(
            'SELECT username FROM group_members WHERE group_id = $1',
            [groupId]
        );
        const members = result.rows.map(row => row.username);
        console.log('Miembros devueltos:', members);
        res.json(members);
    } catch (err) {
        console.error('Error al obtener miembros del grupo:', err);
        res.status(500).json({ error: 'Error al obtener miembros' });
    }
});

// Enviar mensaje de grupo
app.post('/group_messages', async (req, res) => {
    const { group_id, sender, text } = req.body;
    console.log('Enviando mensaje de grupo:', { group_id, sender, text });
    try {
        const checkMember = await pool.query(
            'SELECT username FROM group_members WHERE group_id = $1 AND LOWER(username) = LOWER($2)',
            [group_id, sender]
        );
        if (checkMember.rows.length === 0) {
            return res.status(403).json({ error: 'No eres miembro del grupo' });
        }
        const result = await pool.query(
            'INSERT INTO group_messages (group_id, sender, text) VALUES ($1, $2, $3) RETURNING *',
            [group_id, sender, text]
        );
        const message = result.rows[0];
        console.log('Mensaje de grupo enviado y broadcast:', message);
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
    console.log('Solicitando mensajes del grupo:', groupId);
    try {
        const result = await pool.query(
            'SELECT * FROM group_messages WHERE group_id = $1 ORDER BY timestamp',
            [groupId]
        );
        console.log('Mensajes de grupo devueltos:', result.rows.length);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener mensajes de grupo:', err);
        res.status(500).json({ error: 'Error al obtener mensajes de grupo' });
    }
});

// Actualizar foto del grupo
app.post('/group-pic', async (req, res) => {
    const { group_id, group_pic, username } = req.body;
    console.log('Actualizando foto del grupo:', { group_id, username });
    try {
        const result = await pool.query(
            'UPDATE groups SET group_pic = $1 WHERE group_id = $2 AND LOWER(creator) = LOWER($3) RETURNING *',
            [group_pic, group_id, username]
        );
        if (result.rows.length > 0) {
            console.log('Foto del grupo actualizada:', result.rows[0]);
            res.json(result.rows[0]);
        } else {
            console.log('No autorizado o grupo no encontrado:', { group_id, username });
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
    console.log('Actualizando nombre del grupo:', { group_id, group_name, username });
    try {
        const result = await pool.query(
            'UPDATE groups SET group_name = $1 WHERE group_id = $2 AND LOWER(creator) = LOWER($3) RETURNING *',
            [group_name, group_id, username]
        );
        if (result.rows.length > 0) {
            console.log('Nombre del grupo actualizado:', result.rows[0]);
            res.json(result.rows[0]);
        } else {
            console.log('No autorizado o grupo no encontrado:', { group_id, username });
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
    console.log('Añadiendo miembro al grupo:', { group_id, username, new_member });
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND LOWER(creator) = LOWER($2)',
            [group_id, username]
        );
        if (checkCreator.rows.length === 0) {
            console.log('No autorizado para añadir miembro:', username);
            return res.status(403).json({ error: 'No autorizado' });
        }
        const result = await pool.query(
            'INSERT INTO group_members (group_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
            [group_id, new_member]
        );
        console.log('Miembro añadido:', result.rows[0] || 'Ya existía');
        res.json(result.rows[0] || { message: 'Miembro añadido o ya existía' });
    } catch (err) {
        console.error('Error al añadir miembro al grupo:', err);
        res.status(500).json({ error: 'Error al añadir miembro' });
    }
});

// Eliminar miembro del grupo
app.post('/group-remove-member', async (req, res) => {
    const { group_id, username, member_to_remove } = req.body;
    console.log('Eliminando miembro del grupo:', { group_id, username, member_to_remove });
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND LOWER(creator) = LOWER($2)',
            [group_id, username]
        );
        if (checkCreator.rows.length === 0) {
            console.log('No autorizado para eliminar miembro:', username);
            return res.status(403).json({ error: 'No autorizado' });
        }
        const result = await pool.query(
            'DELETE FROM group_members WHERE group_id = $1 AND LOWER(username) = LOWER($2) RETURNING *',
            [group_id, member_to_remove]
        );
        if (result.rows.length > 0) {
            console.log('Miembro eliminado:', member_to_remove);
            res.json({ message: 'Miembro eliminado' });
        } else {
            console.log('Miembro no encontrado:', member_to_remove);
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
    console.log('Eliminando grupo:', { group_id, username });
    try {
        const checkCreator = await pool.query(
            'SELECT creator FROM groups WHERE group_id = $1 AND LOWER(creator) = LOWER($2)',
            [group_id, username]
        );
        if (checkCreator.rows.length === 0) {
            console.log('No autorizado para eliminar grupo:', username);
            return res.status(403).json({ error: 'No autorizado' });
        }
        await pool.query('DELETE FROM group_messages WHERE group_id = $1', [group_id]);
        await pool.query('DELETE FROM group_members WHERE group_id = $1', [group_id]);
        const result = await pool.query('DELETE FROM groups WHERE group_id = $1 RETURNING *', [group_id]);
        console.log('Grupo eliminado:', result.rows[0]);
        broadcastMessage({ type: 'group_deleted', group_id });
        res.json({ message: 'Grupo eliminado' });
    } catch (err) {
        console.error('Error al eliminar grupo:', err);
        res.status(500).json({ error: 'Error al eliminar grupo' });
    }
});

// Ruta raíz para verificar el servidor
app.get('/', (req, res) => {
    console.log('Solicitud a la raíz recibida');
    res.send('UV Messages Server is running');
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});
