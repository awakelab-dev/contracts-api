import express from 'express';
import cors from 'cors';
import health from './routes/health';
import auth from './routes/auth';
import students from './routes/students';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/health', health);
app.use('/auth', auth);
app.use('/students', students);

export default app;
