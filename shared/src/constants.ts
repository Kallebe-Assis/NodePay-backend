/**
 * Enums e constantes de domínio compartilhadas entre API e front.
 * Os valores devem bater 1:1 com os enums do Prisma (apps/api/prisma/schema.prisma).
 */

export const TIMEZONE = 'America/Sao_Paulo';
export const CURRENCY = 'BRL';
export const LOCALE = 'pt-BR';

export const AccountType = {
  CHECKING: 'CHECKING', // Conta corrente
  SAVINGS: 'SAVINGS', // Poupança
  CASH: 'CASH', // Dinheiro em espécie
  WALLET: 'WALLET', // Carteira digital / caixinha
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountTypeLabel: Record<AccountType, string> = {
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CASH: 'Dinheiro',
  WALLET: 'Carteira / Caixinha',
};

export const CategoryKind = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const;
export type CategoryKind = (typeof CategoryKind)[keyof typeof CategoryKind];

export const UserRole = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  PENDING: 'PENDING', // cadastrado, aguardando aprovação de um admin
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const UserStatusLabel: Record<UserStatus, string> = {
  PENDING: 'Aguardando aprovação',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
};

export const UserRoleLabel: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  USER: 'Usuário',
};

/**
 * Tipos de lançamento no livro-razão.
 * O SINAL (entra/sai) é derivado do tipo, nunca armazenado no valor.
 */
export const TransactionType = {
  EXPENSE: 'EXPENSE', // saída de uma conta (Tela 1)
  INCOME: 'INCOME', // entrada em uma conta
  TRANSFER: 'TRANSFER', // movimentação entre contas (2 pernas)
  CARD_EXPENSE: 'CARD_EXPENSE', // compra no cartão (Tela 2) - não mexe no saldo
  INVOICE_PAYMENT: 'INVOICE_PAYMENT', // pagamento de fatura - debita a conta
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT', // valor do empréstimo caindo na conta
  LOAN_INSTALLMENT: 'LOAN_INSTALLMENT', // parcela de empréstimo saindo da conta
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

/** Tipos que representam saída de dinheiro da conta. */
export const OUTFLOW_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.INVOICE_PAYMENT,
  TransactionType.LOAN_INSTALLMENT,
];
/** Tipos que representam entrada de dinheiro na conta. */
export const INFLOW_TYPES: TransactionType[] = [
  TransactionType.INCOME,
  TransactionType.LOAN_DISBURSEMENT,
];

export const TransactionStatus = {
  PENDING: 'PENDING', // A pagar / a receber (afeta só o saldo projetado)
  SCHEDULED: 'SCHEDULED', // Agendado no futuro (afeta só o saldo projetado)
  PAID: 'PAID', // Liquidado (afeta o saldo atual)
  CANCELED: 'CANCELED', // Cancelado (não afeta nada)
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const RecurrenceMode = {
  FIXED: 'FIXED', // repete todo período, sem data fim
  INSTALLMENT: 'INSTALLMENT', // parcelado, N ocorrências
} as const;
export type RecurrenceMode = (typeof RecurrenceMode)[keyof typeof RecurrenceMode];

export const RecurrenceFrequency = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const;
export type RecurrenceFrequency = (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];

export const InvoiceStatus = {
  OPEN: 'OPEN', // período ainda aberto, aceita novas compras
  CLOSED: 'CLOSED', // fechada, aguardando pagamento
  PAID: 'PAID', // paga
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const LoanSystem = {
  PRICE: 'PRICE', // parcela fixa
  SAC: 'SAC', // amortização fixa, parcela decrescente
} as const;
export type LoanSystem = (typeof LoanSystem)[keyof typeof LoanSystem];

export const LoanStatus = {
  ACTIVE: 'ACTIVE',
  SETTLED: 'SETTLED',
  CANCELED: 'CANCELED',
} as const;
export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];

export const BackupFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
} as const;
export type BackupFrequency = (typeof BackupFrequency)[keyof typeof BackupFrequency];

export const GoalType = {
  SPEND_MAX: 'SPEND_MAX',
  EARN_MIN: 'EARN_MIN',
  NET_MIN: 'NET_MIN',
  END_BALANCE_MIN: 'END_BALANCE_MIN',
} as const;
export type GoalType = (typeof GoalType)[keyof typeof GoalType];

export const GoalTypeLabel: Record<GoalType, string> = {
  SPEND_MAX: 'Gastar no máximo',
  EARN_MIN: 'Receber pelo menos',
  NET_MIN: 'Saldo do período (receita − despesa) de pelo menos',
  END_BALANCE_MIN: 'Terminar o período com saldo de pelo menos',
};

export const GoalRecurrence = {
  ONCE: 'ONCE',
  MONTHLY: 'MONTHLY',
  N_MONTHS: 'N_MONTHS',
} as const;
export type GoalRecurrence = (typeof GoalRecurrence)[keyof typeof GoalRecurrence];

export const GoalRecurrenceLabel: Record<GoalRecurrence, string> = {
  ONCE: 'Uma vez',
  MONTHLY: 'Todo mês',
  N_MONTHS: 'Por alguns meses',
};

/**
 * Ícones de categoria: nomes de exportação do `lucide-react` + termos de busca em pt-BR.
 * O front resolve o nome para o componente (registry em components/category-icon.tsx).
 * String vazia = sem ícone.
 */
export interface CategoryIconDef {
  name: string;
  /** palavras-chave em pt-BR para o campo de busca do seletor */
  label: string;
}

export const CATEGORY_ICON_DEFS: CategoryIconDef[] = [
  // --- alimentação / bebida ---
  { name: 'Utensils', label: 'comida alimentação restaurante garfo faca refeição' },
  { name: 'UtensilsCrossed', label: 'restaurante talheres jantar comida' },
  { name: 'CookingPot', label: 'panela cozinhar comida caseira almoço' },
  { name: 'ChefHat', label: 'chef cozinha gastronomia' },
  { name: 'Pizza', label: 'pizza fast food lanche' },
  { name: 'Sandwich', label: 'sanduíche lanche fast food' },
  { name: 'Drumstick', label: 'frango lanche fast food coxinha' },
  { name: 'Soup', label: 'sopa caldo comida' },
  { name: 'Salad', label: 'salada saudável fit verdura' },
  { name: 'Beef', label: 'carne churrasco açougue proteína' },
  { name: 'Fish', label: 'peixe frutos do mar' },
  { name: 'Egg', label: 'ovo café da manhã' },
  { name: 'Croissant', label: 'padaria pão café da manhã' },
  { name: 'Cookie', label: 'biscoito bolacha doce' },
  { name: 'Cake', label: 'bolo aniversário festa doce' },
  { name: 'CakeSlice', label: 'fatia bolo sobremesa doce' },
  { name: 'IceCreamCone', label: 'sorvete casquinha doce' },
  { name: 'Candy', label: 'bala doce guloseima' },
  { name: 'Donut', label: 'rosquinha donut doce' },
  { name: 'Popcorn', label: 'pipoca cinema lanche' },
  { name: 'Apple', label: 'maçã fruta feira saudável' },
  { name: 'Cherry', label: 'cereja fruta' },
  { name: 'Grape', label: 'uva fruta vinho' },
  { name: 'Carrot', label: 'cenoura legume feira verdura' },
  { name: 'Wheat', label: 'trigo grãos pão cereais' },
  { name: 'Milk', label: 'leite laticínio café da manhã' },
  { name: 'Coffee', label: 'café cafeteria bebida' },
  { name: 'CupSoda', label: 'refrigerante bebida suco' },
  { name: 'GlassWater', label: 'água bebida copo' },
  { name: 'Beer', label: 'cerveja bar bebida álcool' },
  { name: 'Wine', label: 'vinho bar bebida álcool taça' },
  { name: 'Martini', label: 'drink coquetel bar bebida' },
  { name: 'Refrigerator', label: 'geladeira eletrodoméstico cozinha' },
  { name: 'Microwave', label: 'micro-ondas eletrodoméstico cozinha' },

  // --- mercado / compras ---
  { name: 'ShoppingCart', label: 'mercado supermercado compras carrinho' },
  { name: 'ShoppingBag', label: 'compras sacola shopping loja' },
  { name: 'ShoppingBasket', label: 'cesta compras mercado feira' },
  { name: 'Store', label: 'loja comércio mercado varejo' },
  { name: 'Tag', label: 'etiqueta preço promoção desconto' },
  { name: 'Tags', label: 'etiquetas preços promoções' },
  { name: 'Barcode', label: 'código de barras produto compra' },
  { name: 'Receipt', label: 'recibo nota fiscal cupom comprovante' },
  { name: 'ReceiptText', label: 'nota fiscal recibo cupom conta' },
  { name: 'Gift', label: 'presente aniversário compras' },
  { name: 'Package', label: 'pacote encomenda entrega compra online' },
  { name: 'PackageOpen', label: 'encomenda aberta entrega compra' },
  { name: 'Truck', label: 'frete entrega transportadora' },

  // --- vestuário / cuidado pessoal ---
  { name: 'Shirt', label: 'roupa camisa vestuário moda' },
  { name: 'Footprints', label: 'sapato calçado tênis pegadas' },
  { name: 'Glasses', label: 'óculos ótica visão' },
  { name: 'Watch', label: 'relógio acessório' },
  { name: 'Gem', label: 'joia diamante acessório luxo' },
  { name: 'Crown', label: 'coroa luxo premium' },
  { name: 'Scissors', label: 'cabeleireiro corte salão barbearia tesoura' },
  { name: 'Sparkles', label: 'beleza brilho estética' },
  { name: 'Bath', label: 'banho higiene banheiro' },
  { name: 'ShowerHead', label: 'chuveiro banho higiene' },
  { name: 'SprayCan', label: 'spray perfume higiene limpeza' },
  { name: 'Droplet', label: 'água conta de água higiene' },
  { name: 'Droplets', label: 'água limpeza higiene' },

  // --- casa / moradia ---
  { name: 'House', label: 'casa moradia aluguel lar residência' },
  { name: 'BedDouble', label: 'cama quarto móveis dormir' },
  { name: 'Bed', label: 'cama quarto dormir' },
  { name: 'Sofa', label: 'sofá sala móveis' },
  { name: 'Armchair', label: 'poltrona cadeira móveis' },
  { name: 'Lamp', label: 'luminária abajur iluminação' },
  { name: 'LampDesk', label: 'luminária mesa escritório' },
  { name: 'Lightbulb', label: 'luz energia lâmpada conta de luz' },
  { name: 'Plug', label: 'tomada energia eletricidade' },
  { name: 'PlugZap', label: 'energia elétrica luz recarga' },
  { name: 'Zap', label: 'energia elétrica luz raio' },
  { name: 'Flame', label: 'gás fogo chama botijão aquecimento' },
  { name: 'Fan', label: 'ventilador ar climatização' },
  { name: 'AirVent', label: 'ar condicionado climatização' },
  { name: 'Thermometer', label: 'temperatura aquecimento climatização' },
  { name: 'WashingMachine', label: 'lavanderia máquina de lavar roupa' },
  { name: 'Trash2', label: 'lixo coleta descarte' },
  { name: 'Recycle', label: 'reciclagem sustentável lixo' },
  { name: 'DoorOpen', label: 'porta casa entrada' },
  { name: 'KeyRound', label: 'chave casa aluguel imóvel' },
  { name: 'Key', label: 'chave aluguel condomínio imóvel' },
  { name: 'Building', label: 'prédio condomínio apartamento' },
  { name: 'Building2', label: 'prédio empresa condomínio escritório' },
  { name: 'Warehouse', label: 'galpão depósito armazém' },
  { name: 'Wrench', label: 'reparo manutenção ferramenta conserto' },
  { name: 'Hammer', label: 'reforma obra ferramenta martelo' },
  { name: 'Drill', label: 'furadeira reforma ferramenta' },
  { name: 'PaintRoller', label: 'pintura reforma tinta rolo' },
  { name: 'Paintbrush', label: 'pincel pintura reforma' },
  { name: 'Ruler', label: 'régua medida projeto obra' },
  { name: 'HardHat', label: 'obra construção capacete reforma' },

  // --- transporte ---
  { name: 'Car', label: 'carro automóvel transporte veículo' },
  { name: 'CarFront', label: 'carro veículo transporte' },
  { name: 'CarTaxiFront', label: 'táxi uber corrida transporte app' },
  { name: 'Bus', label: 'ônibus transporte público passagem' },
  { name: 'TramFront', label: 'metrô trem transporte público' },
  { name: 'TrainFront', label: 'trem transporte viagem' },
  { name: 'Bike', label: 'bicicleta bike transporte' },
  { name: 'Fuel', label: 'combustível gasolina posto etanol abastecer' },
  { name: 'ParkingMeter', label: 'estacionamento parquímetro zona azul' },
  { name: 'CircleParking', label: 'estacionamento vaga garagem' },
  { name: 'Plane', label: 'avião viagem passagem aérea voo' },
  { name: 'PlaneTakeoff', label: 'decolagem viagem aeroporto voo' },
  { name: 'Ship', label: 'navio cruzeiro barco viagem' },
  { name: 'Sailboat', label: 'barco veleiro passeio' },
  { name: 'Anchor', label: 'âncora barco marina' },
  { name: 'Caravan', label: 'trailer camping viagem motorhome' },
  { name: 'Ambulance', label: 'ambulância emergência saúde' },
  { name: 'Rocket', label: 'foguete lançamento startup' },

  // --- saúde ---
  { name: 'HeartPulse', label: 'saúde plano médico batimento hospital' },
  { name: 'Stethoscope', label: 'médico consulta clínica saúde' },
  { name: 'Pill', label: 'remédio farmácia medicamento comprimido' },
  { name: 'Syringe', label: 'vacina injeção seringa saúde' },
  { name: 'Bandage', label: 'curativo machucado primeiros socorros' },
  { name: 'Cross', label: 'farmácia hospital saúde cruz' },
  { name: 'Activity', label: 'saúde exame cardíaco monitor' },
  { name: 'Brain', label: 'cérebro terapia psicólogo mente' },
  { name: 'Bone', label: 'osso ortopedia fisioterapia' },
  { name: 'Ear', label: 'ouvido audição fonoaudiólogo' },
  { name: 'Eye', label: 'olho oftalmologista visão' },
  { name: 'Microscope', label: 'laboratório exame análise' },
  { name: 'TestTube', label: 'laboratório exame de sangue' },
  { name: 'TestTubes', label: 'laboratório exames análises' },
  { name: 'Dna', label: 'genética exame dna laboratório' },
  { name: 'Dumbbell', label: 'academia musculação treino peso ginástica' },
  { name: 'PersonStanding', label: 'academia postura fisioterapia pilates' },
  { name: 'Accessibility', label: 'acessibilidade cadeirante saúde' },
  { name: 'HandHeart', label: 'cuidado doação apoio' },

  // --- educação ---
  { name: 'GraduationCap', label: 'faculdade escola formatura curso educação' },
  { name: 'BookOpen', label: 'livro leitura estudo curso' },
  { name: 'Book', label: 'livro material escolar leitura' },
  { name: 'BookMarked', label: 'livro estudo apostila' },
  { name: 'Library', label: 'biblioteca livros estudo' },
  { name: 'Backpack', label: 'mochila escola material volta às aulas' },
  { name: 'Pencil', label: 'lápis material escolar escrita' },
  { name: 'PencilRuler', label: 'material escolar desenho projeto' },
  { name: 'PenTool', label: 'caneta design edição' },
  { name: 'NotebookPen', label: 'caderno anotação escola' },
  { name: 'School', label: 'escola colégio ensino mensalidade' },
  { name: 'Presentation', label: 'aula palestra apresentação curso' },
  { name: 'Calculator', label: 'calculadora contabilidade matemática imposto' },
  { name: 'Globe', label: 'mundo geografia idiomas viagem internet' },
  { name: 'Languages', label: 'idiomas inglês curso tradução' },
  { name: 'FlaskConical', label: 'química laboratório experimento ciência' },
  { name: 'Atom', label: 'física ciência átomo' },
  { name: 'Award', label: 'prêmio certificado conquista' },
  { name: 'Medal', label: 'medalha conquista prêmio' },

  // --- lazer / entretenimento ---
  { name: 'Clapperboard', label: 'cinema filme streaming' },
  { name: 'Film', label: 'filme cinema vídeo' },
  { name: 'Tv', label: 'tv televisão streaming assinatura' },
  { name: 'MonitorPlay', label: 'streaming vídeo assinatura filme' },
  { name: 'Gamepad2', label: 'jogos videogame game console' },
  { name: 'Joystick', label: 'jogos game controle arcade' },
  { name: 'Dices', label: 'jogo dado tabuleiro sorte' },
  { name: 'Puzzle', label: 'quebra-cabeça hobby jogo' },
  { name: 'Music', label: 'música streaming show spotify' },
  { name: 'Music4', label: 'música playlist streaming' },
  { name: 'Headphones', label: 'fone música podcast áudio' },
  { name: 'Radio', label: 'rádio música podcast' },
  { name: 'Mic', label: 'microfone karaokê podcast show' },
  { name: 'Guitar', label: 'violão guitarra música instrumento aula' },
  { name: 'Piano', label: 'piano teclado música aula' },
  { name: 'Drum', label: 'bateria música instrumento' },
  { name: 'Speaker', label: 'caixa de som áudio festa' },
  { name: 'Podcast', label: 'podcast áudio assinatura' },
  { name: 'Ticket', label: 'ingresso show evento cinema' },
  { name: 'TicketPercent', label: 'ingresso desconto promoção evento' },
  { name: 'PartyPopper', label: 'festa comemoração evento aniversário' },
  { name: 'Tent', label: 'camping acampamento viagem trilha' },
  { name: 'Palette', label: 'arte pintura hobby tinta' },
  { name: 'Brush', label: 'pincel arte pintura hobby' },
  { name: 'Camera', label: 'câmera foto fotografia hobby' },
  { name: 'Image', label: 'foto imagem galeria' },
  { name: 'Drama', label: 'teatro peça cultura máscara' },
  { name: 'Volleyball', label: 'esporte vôlei bola' },
  { name: 'Trophy', label: 'troféu esporte campeonato conquista' },
  { name: 'Target', label: 'alvo meta objetivo foco' },
  { name: 'Waves', label: 'praia mar surf natação' },

  // --- dinheiro / finanças ---
  { name: 'Banknote', label: 'dinheiro nota cédula pagamento salário' },
  { name: 'Coins', label: 'moedas dinheiro troco poupança' },
  { name: 'DollarSign', label: 'dinheiro cifrão pagamento valor' },
  { name: 'CircleDollarSign', label: 'dinheiro pagamento valor' },
  { name: 'HandCoins', label: 'pagamento dinheiro doação gorjeta mesada' },
  { name: 'PiggyBank', label: 'poupança cofrinho economia guardar' },
  { name: 'Wallet', label: 'carteira dinheiro' },
  { name: 'WalletCards', label: 'carteira cartões pagamento' },
  { name: 'CreditCard', label: 'cartão de crédito fatura pagamento' },
  { name: 'Landmark', label: 'banco governo imposto instituição' },
  { name: 'Vault', label: 'cofre banco reserva segurança' },
  { name: 'TrendingUp', label: 'investimento alta ganho lucro renda' },
  { name: 'TrendingDown', label: 'perda queda prejuízo' },
  { name: 'ChartLine', label: 'gráfico investimento ações bolsa' },
  { name: 'ChartColumnBig', label: 'gráfico relatório análise' },
  { name: 'ChartPie', label: 'gráfico distribuição orçamento' },
  { name: 'Percent', label: 'juros porcentagem taxa desconto' },
  { name: 'Bitcoin', label: 'cripto bitcoin investimento moeda' },
  { name: 'Scale', label: 'balança justiça advogado imposto equilíbrio' },
  { name: 'Handshake', label: 'acordo negócio parceria contrato' },
  { name: 'BadgeDollarSign', label: 'renda bônus pagamento valor' },
  { name: 'BadgePercent', label: 'desconto promoção cupom' },
  { name: 'FileText', label: 'documento contrato boleto papel' },

  // --- trabalho / tecnologia / serviços ---
  { name: 'Briefcase', label: 'trabalho emprego negócio maleta' },
  { name: 'BriefcaseBusiness', label: 'trabalho empresa profissional' },
  { name: 'Laptop', label: 'notebook computador trabalho tecnologia' },
  { name: 'Monitor', label: 'monitor computador tecnologia' },
  { name: 'Smartphone', label: 'celular telefone conta plano' },
  { name: 'Tablet', label: 'tablet ipad tecnologia' },
  { name: 'Mouse', label: 'mouse periférico computador' },
  { name: 'Keyboard', label: 'teclado periférico computador' },
  { name: 'HardDrive', label: 'hd armazenamento backup' },
  { name: 'Server', label: 'servidor hospedagem nuvem' },
  { name: 'Database', label: 'banco de dados armazenamento' },
  { name: 'Cloud', label: 'nuvem assinatura armazenamento serviço' },
  { name: 'Cpu', label: 'processador hardware tecnologia' },
  { name: 'Printer', label: 'impressora escritório impressão' },
  { name: 'Bot', label: 'robô automação ia assistente' },
  { name: 'Code', label: 'código programação desenvolvimento' },
  { name: 'Terminal', label: 'terminal programação servidor' },
  { name: 'Wifi', label: 'internet wi-fi conta provedor' },
  { name: 'Router', label: 'roteador internet wi-fi' },
  { name: 'Phone', label: 'telefone ligação conta fixa' },
  { name: 'PhoneCall', label: 'ligação telefone chamada' },
  { name: 'Mail', label: 'email correio carta' },
  { name: 'MessageSquare', label: 'mensagem chat conversa' },
  { name: 'Send', label: 'enviar mensagem transferência' },
  { name: 'Newspaper', label: 'jornal notícia assinatura revista' },
  { name: 'Users', label: 'pessoas equipe grupo família' },
  { name: 'UserRound', label: 'pessoa usuário perfil' },
  { name: 'Calendar', label: 'calendário agenda data evento' },
  { name: 'CalendarClock', label: 'agendamento prazo vencimento' },
  { name: 'Clock', label: 'hora tempo prazo relógio' },
  { name: 'AlarmClock', label: 'alarme despertador lembrete' },
  { name: 'Hourglass', label: 'ampulheta tempo espera' },
  { name: 'Timer', label: 'cronômetro tempo' },
  { name: 'Shield', label: 'seguro proteção segurança' },
  { name: 'ShieldCheck', label: 'seguro proteção garantia' },
  { name: 'Lock', label: 'cadeado segurança senha' },
  { name: 'Umbrella', label: 'seguro proteção guarda-chuva chuva' },
  { name: 'Cog', label: 'configuração serviço engrenagem manutenção' },
  { name: 'LifeBuoy', label: 'suporte ajuda socorro' },

  // --- pets / natureza / animais ---
  { name: 'Dog', label: 'cachorro pet animal cão' },
  { name: 'Cat', label: 'gato pet animal' },
  { name: 'Bird', label: 'pássaro pet ave' },
  { name: 'Rabbit', label: 'coelho pet animal' },
  { name: 'PawPrint', label: 'pet animal veterinário pata' },
  { name: 'Bug', label: 'inseto dedetização praga' },
  { name: 'TreePine', label: 'árvore natureza natal pinheiro' },
  { name: 'TreeDeciduous', label: 'árvore natureza jardim' },
  { name: 'Trees', label: 'floresta parque natureza' },
  { name: 'Flower', label: 'flor jardim presente floricultura' },
  { name: 'Flower2', label: 'flor buquê presente' },
  { name: 'Sprout', label: 'muda planta jardinagem horta' },
  { name: 'Leaf', label: 'folha natureza sustentável planta' },
  { name: 'LeafyGreen', label: 'verdura horta orgânico folha' },
  { name: 'Sun', label: 'sol dia clima energia solar' },
  { name: 'Moon', label: 'lua noite' },
  { name: 'CloudRain', label: 'chuva clima tempo' },
  { name: 'Snowflake', label: 'neve frio inverno gelo' },
  { name: 'Wind', label: 'vento clima ar' },
  { name: 'Mountain', label: 'montanha trilha viagem natureza' },
  { name: 'Feather', label: 'pena leve escrita' },
  { name: 'Shell', label: 'concha praia mar' },

  // --- família / diversos ---
  { name: 'Baby', label: 'bebê filho criança maternidade fralda' },
  { name: 'ToyBrick', label: 'brinquedo criança lego' },
  { name: 'Cigarette', label: 'cigarro tabaco vício' },
  { name: 'Church', label: 'igreja dízimo religião doação' },
  { name: 'HeartHandshake', label: 'doação ajuda apoio parceria' },
  { name: 'Heart', label: 'saúde amor favorito doação' },
  { name: 'Star', label: 'favorito destaque avaliação' },
  { name: 'Bookmark', label: 'salvo favorito marcador' },
  { name: 'Flag', label: 'bandeira meta marco país' },
  { name: 'MapPin', label: 'local endereço mapa lugar' },
  { name: 'Map', label: 'mapa viagem rota localização' },
  { name: 'Compass', label: 'bússola viagem direção aventura' },
  { name: 'Luggage', label: 'mala bagagem viagem' },
  { name: 'Sparkle', label: 'brilho especial destaque' },
  { name: 'WandSparkles', label: 'mágica varinha especial' },
  { name: 'Sticker', label: 'adesivo etiqueta' },
  { name: 'Package2', label: 'caixa pacote guardar' },
  { name: 'Folder', label: 'pasta documento arquivo' },
  { name: 'Archive', label: 'arquivo caixa guardar histórico' },
  { name: 'CircleHelp', label: 'diversos outros dúvida' },
  { name: 'Ellipsis', label: 'outros diversos mais reticências' },
];

/** apenas os nomes (compat). */
export const CATEGORY_ICONS = CATEGORY_ICON_DEFS.map((d) => d.name);
export type CategoryIconName = string;

/**
 * Bancos/instituições para o cartão de crédito. `color` é a cor da marca,
 * usada num selo circular com as iniciais (placeholder até haver a logo real).
 */
export interface BankOption {
  id: string;
  name: string;
  color: string;
}
export const BANKS: BankOption[] = [
  { id: 'nubank', name: 'Nubank', color: '#820AD1' },
  { id: 'itau', name: 'Itaú', color: '#EC7000' },
  { id: 'bradesco', name: 'Bradesco', color: '#CC092F' },
  { id: 'santander', name: 'Santander', color: '#EC0000' },
  { id: 'bb', name: 'Banco do Brasil', color: '#003399' },
  { id: 'caixa', name: 'Caixa', color: '#1C5FAF' },
  { id: 'inter', name: 'Inter', color: '#FF7A00' },
  { id: 'c6', name: 'C6 Bank', color: '#242424' },
  { id: 'btg', name: 'BTG Pactual', color: '#0D1B3E' },
  { id: 'original', name: 'Original', color: '#00A868' },
  { id: 'next', name: 'Next', color: '#16F07E' },
  { id: 'neon', name: 'Neon', color: '#00E5C3' },
  { id: 'pagbank', name: 'PagBank', color: '#0AB776' },
  { id: 'mercadopago', name: 'Mercado Pago', color: '#00B1EA' },
  { id: 'xp', name: 'XP', color: '#0A0A0A' },
  { id: 'safra', name: 'Safra', color: '#1A2A4F' },
  { id: 'sicoob', name: 'Sicoob', color: '#003641' },
  { id: 'sicredi', name: 'Sicredi', color: '#3FA110' },
  { id: 'brb', name: 'BRB', color: '#005CA9' },
  { id: 'banrisul', name: 'Banrisul', color: '#0072BC' },
  { id: 'picpay', name: 'PicPay', color: '#21C25E' },
  { id: 'will', name: 'Will Bank', color: '#FFCC00' },
  { id: 'digio', name: 'Digio', color: '#005CFF' },
  { id: 'sofisa', name: 'Sofisa', color: '#E30613' },
  { id: 'outros', name: 'Outros', color: '#64748B' },
];

/** Categorias padrão criadas no primeiro acesso de um usuário. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Moradia',
  'Infraestrutura',
  'Saúde',
  'Educação',
  'Lazer',
  'Compras',
  'Assinaturas',
  'Impostos e tarifas',
  'Outros',
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  'Salário',
  'Freelance',
  'Investimentos',
  'Reembolso',
  'Outros',
] as const;
