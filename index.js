require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const { HfInference } = require("@huggingface/inference");

// Inicializar dependencias
const app = express();
const prisma = new PrismaClient();
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// Resolver preguntas con Hugging Face
async function questionAnswering(question, context) {
  const response = await hf.request({
    model: "distilbert-base-uncased-distilled-squad",
    inputs: {
      question: question,
      context: context,
    },
  });
  return { answer: response.answer, model: "Hugging Face - distilbert" };
}

// Resolver preguntas con ChatGPT
async function respondWithChatGPT(question) {
  const chatResponse = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5",
      messages: [{ role: "user", content: question }],
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    }
  );
  return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
}

// Guardar interacción en la base de datos
async function saveInteraction(question, answer, model) {
  await prisma.interaction.create({
    data: {
      question,
      answer: `${answer} (Respondido con: ${model})`,
    },
  });
}

// Recuperar interacciones previas relacionadas
async function retrievePreviousInteractions(question) {
  return await prisma.interaction.findMany({
    where: {
      question: { contains: question },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Procesar solicitud según palabras clave
async function processRequest(input) {
  if (input.toLowerCase().includes("gpt")) {
    return await respondWithChatGPT(input);
  } else if (input.toLowerCase().includes("accion")) {
    return { action: true };
  } else if (input.trim().toLowerCase() === "hola") {
    return { answer: "Hola, ¿cómo puedo ayudarte?", model: "Mensaje Predeterminado" };
  } else {
    return await questionAnswering(input, "Contexto: Este es un asistente virtual que puede responder preguntas generales y ayudarte con diversas tareas.");
  }
}

// Endpoint principal
app.post("/ask", async (req, res) => {
  const { input } = req.body;

  if (!input || input.trim() === "") {
    res.status(400).json({ error: "La entrada no puede estar vacía." });
    return;
  }

  try {
    let response;
    let modelUsed;

    // Procesar la solicitud según el contenido del parámetro "input"
    const result = await processRequest(input);

    if (result.action) {
      // Si es una acción, activa Make webhook
      await axios.post(MAKE_WEBHOOK_URL, {
        accion: "realizar_accion",
        details: {
          input,
          message: "Acción activada mediante palabra clave.",
        },
      });
      res.json({ message: "Acción enviada a Make." });
      return;
    } else {
      response = result.answer;
      modelUsed = result.model;
    }

    // Guardar respuesta en la base de datos
    await saveInteraction(input, response, modelUsed);

    // Responder al cliente
    res.json({
      answer: `${response} (Respondido con: ${modelUsed})`,
    });
  } catch (error) {
    console.error("Error procesando la pregunta:", error);
    res.status(500).send("Error procesando la pregunta");
  }
});

// Iniciar el servidor
app.listen(3000, () => {
  console.log("Agente de IA ejecutándose en http://localhost:3000");
});

// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-4",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Procesar solicitud según palabras clave
// async function processRequest(input) {
//   if (input.toLowerCase().includes("gpt")) {
//     return await respondWithChatGPT(input);
//   } else if (input.toLowerCase().includes("accion")) {
//     return { action: true };
//   } else {
//     return await questionAnswering(input, "Información general para el agente de IA.");
//   }
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { input } = req.body;

//   try {
//     let response;
//     let modelUsed;

//     // Procesar la solicitud según el contenido del parámetro "input"
//     const result = await processRequest(input);

//     if (result.action) {
//       // Si es una acción, activa Make webhook
//       await axios.post(MAKE_WEBHOOK_URL, {
//         accion: "realizar_accion",
//         details: {
//           input,
//           message: "Acción activada mediante palabra clave.",
//         },
//       });
//       res.json({ message: "Acción enviada a Make." });
//       return;
//     } else {
//       response = result.answer;
//       modelUsed = result.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(input, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });


// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-3.5",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { question } = req.body;

//   try {
//     // Buscar respuestas previas
//     const interactions = await retrievePreviousInteractions(question);
//     if (interactions.length > 0) {
//       res.json({
//         answer: `Respuestas previas: ${interactions.map((i) => i.answer).join("; ")}`,
//       });
//       return;
//     }

//     let response;
//     let modelUsed;

//     // Verificar si la pregunta pide específicamente usar ChatGPT
//     if (question.toLowerCase().includes("responder con chatgpt")) {
//       const chatGPTResponse = await respondWithChatGPT(question);
//       response = chatGPTResponse.answer;
//       modelUsed = chatGPTResponse.model;
//     } else {
//       // Usar Hugging Face para preguntas generales
//       const hfResponse = await questionAnswering(
//         question,
//         "Información general para el agente de IA."
//       );
//       response = hfResponse.answer;
//       modelUsed = hfResponse.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(question, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });

//     // Activar flujo en Make si es necesario
//     if (question.toLowerCase().includes("enviar correo")) {
//       await axios.post(MAKE_WEBHOOK_URL, {
//         action: "send_email",
//         details: {
//           subject: "Solicitud desde el agente",
//           content: response,
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });

// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-3.5",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { question } = req.body;

//   try {
//     // Buscar respuestas previas
//     const interactions = await retrievePreviousInteractions(question);
//     if (interactions.length > 0) {
//       res.json({
//         answer: `Respuestas previas: ${interactions.map((i) => i.answer).join("; ")}`,
//       });
//       return;
//     }

//     let response;
//     let modelUsed;

//     // Verificar si la pregunta pide específicamente usar ChatGPT
//     if (question.toLowerCase().includes("responder con chatgpt")) {
//       const chatGPTResponse = await respondWithChatGPT(question);
//       response = chatGPTResponse.answer;
//       modelUsed = chatGPTResponse.model;
//     } else {
//       // Usar Hugging Face para preguntas generales
//       const hfResponse = await questionAnswering(
//         question,
//         "Información general para el agente de IA."
//       );
//       response = hfResponse.answer;
//       modelUsed = hfResponse.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(question, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });

//     // Activar flujo en Make si es necesario
//     if (question.toLowerCase().includes("enviar correo")) {
//       await axios.post(MAKE_WEBHOOK_URL, {
//         action: "send_email",
//         details: {
//           subject: "Solicitud desde el agente",
//           content: response,
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });
