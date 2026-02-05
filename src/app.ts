import express from 'express';
import cors from 'cors';
import health from './routes/health';
import auth from './routes/auth';
import students from './routes/students';
import vacancies from './routes/vacancies';
import companies from './routes/companies';
import interviews from './routes/interviews';
import internships from './routes/internships';
import invitations from './routes/invitations';
import studentCourses from './routes/studentCourses';
import pnl from './routes/pnl';
import hiringContracts from './routes/hiringContracts';
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
app.use('/internships', internships);
app.use('/invitations', invitations);
app.use('/student-courses', studentCourses);
app.use('/pnl', pnl);
app.use('/hiring-contracts', hiringContracts);
app.use('/stats', stats);

export default app;
