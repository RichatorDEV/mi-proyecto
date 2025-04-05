from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit
import sqlite3

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Tu código existente de rutas HTTP aquí (login, register, messages, etc.)

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
    # Notificar a los usuarios relevantes
    if 'group_id' in message:
        group_id = message['group_id']
        conn = sqlite3.connect('database.db')
        cursor = conn.cursor()
        cursor.execute("SELECT username FROM group_members WHERE group_id = ?", (group_id,))
        members = [row[0] for row in cursor.fetchall()]
        conn.close()
        for member in members:
            if member in clients:
                socketio.emit('message', message, room=clients[member])
    else:
        receiver = message['receiver']
        if receiver in clients:
            socketio.emit('message', message, room=clients[receiver])
        if message['sender'] in clients:
            socketio.emit('message', message, room=clients[message['sender']])

@app.route('/messages', methods=['POST'])
def send_message():
    data = request.json
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute("INSERT INTO messages (sender, receiver, text, timestamp) VALUES (?, ?, ?, ?)",
                   (data['sender'], data['receiver'], data['text'], data.get('timestamp', 'CURRENT_TIMESTAMP')))
    message_id = cursor.lastrowid
    conn.commit()
    conn.close()
    message = {**data, 'id': message_id}
    notify_message(message)
    return jsonify(message)

@app.route('/group_messages', methods=['POST'])
def send_group_message():
    data = request.json
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute("INSERT INTO group_messages (group_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
                   (data['group_id'], data['sender'], data['text'], data.get('timestamp', 'CURRENT_TIMESTAMP')))
    message_id = cursor.lastrowid
    conn.commit()
    conn.close()
    message = {**data, 'id': message_id}
    notify_message(message)
    return jsonify(message)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000)
