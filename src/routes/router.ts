import {Router} from 'express';
import {validate} from '../middlewares/validate';
import * as usersController from '../controllers/usersController';
import * as ordersController from '../controllers/ordersController';
import * as instrumentsController from '../controllers/instrumentsController';
import {userParams, orderParams, createOrderBody} from '../schemas/users';
import {listInstrumentsQuery} from '../schemas/instruments';

const router = Router();

router.get('/assets', validate({query: listInstrumentsQuery}), instrumentsController.list);
router.get('/users', usersController.list);
router.get('/users/:id', validate({params: userParams}), usersController.getById);
router.get('/users/:id/portfolio', validate({params: userParams}), ordersController.portfolio);
router.get('/users/:id/orders', validate({params: userParams}), ordersController.listOrders);
router.post('/users/:id/orders', validate({params: userParams, body: createOrderBody}), ordersController.createOrder);
router.delete('/users/:id/orders/:orderId', validate({params: orderParams}), ordersController.cancelOrder);

export default router;
