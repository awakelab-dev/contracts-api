import express from 'express';
import cors from 'cors';
import health from './routes/health';
import auth from './routes/auth';
import students from './routes/students';
import vacancies from './routes/vacancies';
import companies from './routes/companies';
import interviews from './routes/interviews';
import internships from './routes/internships';
import stats from './routes/stats';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/health', health);
app.use('/auth', auth);
app.use('/students', students);
app.use('/vacancies', vacancies);
app.use('/companies', companies);
app.use('/interviews', interviews);
app.use('/internships', internships)
app.use('/stats', stats)

export default app;
