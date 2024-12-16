"use client";

import { useState } from "react";

export default function Home() {
  const [text, setText] = useState("");
  const [audio, setAudio] = useState(null);
  const [response, setResponse] = useState("");
  const [audioUrl, setAudioUrl] = useState("");

  const sendText = async (e) => {
    e.preventDefault();
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, userId: "usuario123" }),
    });
    const data = await res.json();
    setResponse(data.answer);
    setAudioUrl(data.audio ? `http://localhost:3000/${data.audio}` : null);
  };

  const sendAudio = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("audio", audio);

    const res = await fetch("/api/audio", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    setResponse(data.transcription);
  };

  return (
    <div>
      <h1>Agente de IA</h1>

      {/* Enviar texto */}
      <form onSubmit={sendText}>
        <label>
          Pregunta o Comando:
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit">Enviar</button>
      </form>

      {/* Enviar audio */}
      <form onSubmit={sendAudio}>
        <label>
          Subir Audio:
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setAudio(e.target.files[0])}
          />
        </label>
        <button type="submit">Enviar Audio</button>
      </form>

      {/* Mostrar respuesta */}
      {response && (
        <div>
          <h3>Respuesta:</h3>
          <p>{response}</p>
        </div>
      )}

      {/* Reproducir audio */}
      {audioUrl && (
        <div>
          <h3>Respuesta en Audio:</h3>
          <audio controls src={audioUrl}></audio>
        </div>
      )}
    </div>
  );
}
