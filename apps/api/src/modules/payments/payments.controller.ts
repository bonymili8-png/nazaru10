import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CreatePaymentRequest, type PaymentDto, type ProductDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { PaymentsService } from "./payments.service.js";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("products")
  products(): ProductDto[] {
    return this.payments.products();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<PaymentDto> {
    return this.payments.create(user.id, parse(CreatePaymentRequest, body).productId);
  }

  /** The client polls this after `invoiceClosed`; the status only changes via the bot webhook. */
  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<PaymentDto> {
    return this.payments.get(user.id, id);
  }
}
