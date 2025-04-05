from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
import sqlite3
import os

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

DATABASE = 'database.db'

# Crear base de datos y tablas si no existen
def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        profile_pic TEXT
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS contacts (
        username TEXT,
        contact TEXT,
        FOREIGN KEY (username) REFERENCES users(username),
        FOREIGN KEY (contact) REFERENCES users(username)
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        receiver TEXT,
        text TEXT,
        timestamp TEXT,
        FOREIGN KEY (sender) REFERENCES users(username),
        FOREIGN KEY (receiver) REFERENCES users(username)
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS groups (
        group_id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT,
        creator TEXT,
        group_pic TEXT,
        FOREIGN KEY (creator) REFERENCES users(username)
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS group_members (
        group_id INTEGER,
        username TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(group_id),
        FOREIGN KEY (username) REFERENCES users(username)
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER,
        sender TEXT,
        text TEXT,
        timestamp TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(group_id),
        FOREIGN KEY (sender) REFERENCES users(username)
    )''')
    conn.commit()
    conn.close()

init_db()

clients = {}  # Almacenar conexiones WebSocket por usuario

@socketio.on('connect')
def handle_connect():
    username = request.args.get('username')
    if username:
        clients[username] = request.sid
        print(f"Usuario {username} conectado con SID {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    for username, sid in list(clients.items()):
        if sid == request.sid:
            del clients[username]
            print(f"Usuario {username} desconectado")

def notify_message(message):
    if 'group_id' in message:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute("SELECT username FROM group_members WHERE group_id = ?", (message['group_id'],))
        members = [row[0] for row in cursor.fetchall()]
        conn.close()
        for member in members:
            if member in clients:
                socketio.emit('message', message, room=clients[member])
    else:
        receiver = message['receiver']
        sender = message['sender']
        if receiver in clients:
            socketio.emit('message', message, room=clients[receiver])
        if sender in clients and sender != receiver:
            socketio.emit('message', message, room=clients[sender])

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ? AND password = ?", (data['username'], data['password']))
    user = cursor.fetchone()
    conn.close()
    if user:
        return jsonify({'username': user[0], 'profile_pic': user[2]})
    return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password) VALUES (?, ?)", (data['username'], data['password']))
        conn.commit()
        return jsonify({'message': 'Usuario registrado'})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'El usuario ya existe'}), 400
    finally:
        conn.close()

@app.route('/contacts/<username>', methods=['GET'])
def get_contacts(username):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT contact FROM contacts WHERE username = ?", (username,))
    contacts = [row[0] for row in cursor.fetchall()]
    conn.close()
    return jsonify(contacts)

@app.route('/contacts', methods=['POST'])
def add_contact():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO contacts (username, contact) VALUES (?, ?)", (data['username'], data['contact']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Contacto añadido'})

@app.route('/messages/<sender>/<receiver>', methods=['GET'])
def get_messages(sender, receiver):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, sender, receiver, text, timestamp FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)",
                   (sender, receiver, receiver, sender))
    messages = [{'id': row[0], 'sender': row[1], 'receiver': row[2], 'text': row[3], 'timestamp': row[4]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(messages)

@app.route('/messages', methods=['POST'])
def send_message():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO messages (sender, receiver, text, timestamp) VALUES (?, ?, ?, ?)",
                   (data['sender'], data['receiver'], data['text'], data.get('timestamp', 'CURRENT_TIMESTAMP')))
    message_id = cursor.lastrowid
    conn.commit()
    conn.close()
    message = {**data, 'id': message_id}
    notify_message(message)
    return jsonify(message)

@app.route('/profile-pic/<username>', methods=['GET'])
def get_profile_pic(username):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT profile_pic FROM users WHERE username = ?", (username,))
    result = cursor.fetchone()
    conn.close()
    return jsonify({'profile_pic': result[0] if result else None})

@app.route('/profile-pic', methods=['POST'])
def update_profile_pic():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET profile_pic = ? WHERE username = ?", (data['profilePic'], data['username']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Foto actualizada'})

@app.route('/groups/<username>', methods=['GET'])
def get_groups(username):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT group_id, group_name, creator, group_pic FROM groups WHERE group_id IN (SELECT group_id FROM group_members WHERE username = ?)", (username,))
    groups = [{'group_id': row[0], 'group_name': row[1], 'creator': row[2], 'group_pic': row[3]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(groups)

@app.route('/groups', methods=['POST'])
def create_group():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO groups (group_name, creator, group_pic) VALUES (?, ?, ?)", (data['group_name'], data['creator'], data['group_pic']))
    group_id = cursor.lastrowid
    members = data['members'] + [data['creator']]
    cursor.executemany("INSERT INTO group_members (group_id, username) VALUES (?, ?)", [(group_id, member) for member in members])
    conn.commit()
    conn.close()
    return jsonify({'group_id': group_id})

@app.route('/group-members/<int:group_id>', methods=['GET'])
def get_group_members(group_id):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT username FROM group_members WHERE group_id = ?", (group_id,))
    members = [row[0] for row in cursor.fetchall()]
    conn.close()
    return jsonify(members)

@app.route('/group_messages/<int:group_id>', methods=['GET'])
def get_group_messages(group_id):
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, group_id, sender, text, timestamp FROM group_messages WHERE group_id = ?", (group_id,))
    messages = [{'id': row[0], 'group_id': row[1], 'sender': row[2], 'text': row[3], 'timestamp': row[4]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(messages)

@app.route('/group_messages', methods=['POST'])
def send_group_message():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO group_messages (group_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
                   (data['group_id'], data['sender'], data['text'], data.get('timestamp', 'CURRENT_TIMESTAMP')))
    message_id = cursor.lastrowid
    conn.commit()
    conn.close()
    message = {**data, 'id': message_id}
    notify_message(message)
    return jsonify(message)

@app.route('/group-pic', methods=['POST'])
def update_group_pic():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("UPDATE groups SET group_pic = ? WHERE group_id = ? AND creator = ?", (data['group_pic'], data['group_id'], data['username']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Foto del grupo actualizada'})

@app.route('/group-name', methods=['POST'])
def update_group_name():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("UPDATE groups SET group_name = ? WHERE group_id = ? AND creator = ?", (data['group_name'], data['group_id'], data['username']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Nombre del grupo actualizado'})

@app.route('/group-add-member', methods=['POST'])
def add_group_member():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO group_members (group_id, username) VALUES (?, ?)", (data['group_id'], data['new_member']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Miembro añadido'})

@app.route('/group-remove-member', methods=['POST'])
def remove_group_member():
    data = request.json
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM group_members WHERE group_id = ? AND username = ?", (data['group_id'], data['member_to_remove']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Miembro expulsado'})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
