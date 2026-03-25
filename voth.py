import sys
import numpy as np
import pandas as pd

try:
    from sklearn.cluster import KMeans
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.preprocessing import MinMaxScaler
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import r2_score
except ImportError:
    raise ImportError('Instale scikit-learn: pip install scikit-learn')


def compute_bottleneck_score(df):
    x = df.copy()
    scaler = MinMaxScaler()
    for col in ['Tempo', 'Fila', 'Dependencias', 'Disponibilidade']:
        if col not in x.columns:
            raise ValueError(f'Coluna obrigatória não encontrada: {col}')

    x[['tempo_n', 'fila_n', 'dep_n', 'disp_n']] = scaler.fit_transform(
        x[['Tempo', 'Fila', 'Dependencias', 'Disponibilidade']].astype(float)
    )

    # score clássico TOC: maior tempo/fila/dep + baixa disponibilidade
    score = (0.5 * x['tempo_n'] + 0.3 * x['fila_n'] + 0.2 * x['dep_n'])
    # disponibilidade deve reduzir o score quando alta
    score = score * (1 + (1 - x['disp_n']) * 0.5)
    x['BottleneckScore'] = np.round(score, 4)

    conditions = [x['BottleneckScore'] >= 0.7, x['BottleneckScore'] >= 0.4]
    choices = ['Alto impacto (gargalo crítico)', 'Médio impacto (atenção)']
    x['Impacto'] = np.select(conditions, choices, default='Baixo impacto (fluido)')

    # ranking
    x = x.sort_values('BottleneckScore', ascending=False).reset_index(drop=True)
    x['RankGargalo'] = x.index + 1

    # ordem sugerida - priorizar gargalos alto/medio em primeiro lugar
    cat_order = {'Alto impacto (gargalo crítico)': 1,
                 'Médio impacto (atenção)': 2,
                 'Baixo impacto (fluido)': 3}
    x['_cat'] = x['Impacto'].map(cat_order).fillna(4)
    x = x.sort_values(['_cat', 'Ordem', 'BottleneckScore']).drop(columns=['_cat'])
    x['OrdemOtima'] = np.arange(1, len(x) + 1)

    return x


def recommend_actions(row, full_df):
    recs = []
    if row['Impacto'].startswith('Alto'):
        recs.append('Automatizar etapas manuais e reduzir setup')
        recs.append('Criar buffer e capacidades redundantes')
        recs.append('Paralelizar subprocessos e/ou redistribuir carga')
    elif row['Impacto'].startswith('Médio'):
        recs.append('Monitorar ciclo e remover desperdícios (7 mudas)')
        recs.append('Estudar batch size e trabalho em progresso')
        recs.append('Avaliar balanceamento de recursos e transferência de tarefas')
    else:
        recs.append('Manter performance, evitar excesso de WIP')
        recs.append('Simplificar passos e aumentar estabilidade')

    if row['Disponibilidade'] < np.percentile(full_df['Disponibilidade'], 40):
        recs.append('Aumentar disponibilidade (turnos, manutenção preventiva)')
    if row['Fila'] > np.percentile(full_df['Fila'], 60):
        recs.append('Eliminar gargalo com smoothing de fluxo e pull')

    return ' | '.join(recs)


def clustering_kmeans(df, n_clusters=3):
    kdf = df[['Tempo', 'Fila', 'Dependencias', 'Disponibilidade']].copy()
    kdf = kdf.fillna(kdf.mean())
    scaler = MinMaxScaler()
    kdf_scaled = scaler.fit_transform(kdf)
    k = min(n_clusters, len(df))
    model = KMeans(n_clusters=k, random_state=42, n_init='auto')
    labels = model.fit_predict(kdf_scaled)
    return labels, model


def random_forest_importance(df):
    if 'Atraso' not in df.columns:
        # construir variável proxy de atraso a partir de gargalo
        df = df.copy()
        df['Atraso'] = df['Tempo'] * 0.4 + df['Fila'] * 0.4 + df['Dependencias'] * 0.2

    features = ['Tempo', 'Fila', 'Dependencias', 'Ordem', 'Disponibilidade']
    X = df[features].values
    y = df['Atraso'].values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
    model = RandomForestRegressor(random_state=42, n_estimators=200)
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    r2 = r2_score(y_test, y_pred)
    importances = list(zip(features, model.feature_importances_))
    importances.sort(key=lambda x: x[1], reverse=True)
    return r2, importances


def show_report(df, show_extra=False):
    print('\n=== Tabela de análise de gargalos ===\n')
    print(df[['Posto', 'Tempo', 'Fila', 'Dependencias', 'Ordem', 'Disponibilidade',
               'BottleneckScore', 'Impacto', 'RankGargalo', 'OrdemOtima']])

    print('\n=== Ranking de gargalos (top 5) ===\n')
    print(df[['RankGargalo', 'Posto', 'BottleneckScore', 'Impacto']].head(5))

    df['Recomendacoes'] = df.apply(lambda row: recommend_actions(row, df), axis=1)
    print('\n=== Recomendações estratégicas (exemplo) ===\n')
    for idx, row in df.head(6).iterrows():
        print(f"{row['RankGargalo']}. {row['Posto']}: {row['Impacto']} -> {row['Recomendacoes']}")

    labels, kmodel = clustering_kmeans(df, n_clusters=3)
    df['Cluster'] = labels
    print('\n=== K-Means Clusters ===\n')
    print(df[['Posto', 'Cluster']])

    r2, features_imp = random_forest_importance(df)
    print('\n=== Random Forest (importância de features) ===\n')
    print(f'R2 estimado: {r2:.4f}')
    for feat, imp in features_imp:
        print(f'{feat}: {imp:.4f}')

    if show_extra:
        print('\n=== DataFrame completo ===\n')
        print(df)


def prepare_dataframe(df):
    x = df.copy()

    # Normalizar nomes de colunas comuns do Excel recebido
    if 'Equipamento' in x.columns:
        x['Posto'] = x['Equipamento']
    elif 'Processo' in x.columns:
        x['Posto'] = x['Processo']

    if 'Duração' in x.columns:
        x['Tempo'] = x['Duração']
    elif 'Tempo' in x.columns:
        x['Tempo'] = x['Tempo']

    if 'Número' in x.columns:
        x['Ordem'] = x['Número']
    elif 'Ordem de Produção' in x.columns:
        x['Ordem'] = x['Ordem de Produção']
    elif 'Ordem' in x.columns:
        x['Ordem'] = x['Ordem']

    if 'Processo' in x.columns:
        x['Dependencias'] = x.groupby('Posto')['Processo'].transform('nunique')
    else:
        x['Dependencias'] = 1

    x['Fila'] = x.groupby('Posto')['Posto'].transform('count')

    if 'Prazo' in x.columns:
        pr = pd.to_datetime(x['Prazo'], errors='coerce')
        hoje = pd.Timestamp.now().normalize()
        if pr.dt.tz is not None:
            pr = pr.dt.tz_convert(None)
        days_left = (pr - hoje).dt.days.clip(lower=0)
        x['Disponibilidade'] = days_left / (days_left.max() if days_left.max() > 0 else 1)
        x['Disponibilidade'] = x['Disponibilidade'].fillna(0.0)
    else:
        x['Disponibilidade'] = x.get('Disponibilidade', 1).fillna(1)

    needed = ['Posto', 'Tempo', 'Fila', 'Dependencias', 'Ordem', 'Disponibilidade']
    for c in needed:
        if c not in x.columns:
            raise ValueError(f'Coluna obrigatória não encontrada após mapeamento: {c}')

    x = x[needed].copy()
    x['Tempo'] = x['Tempo'].astype(float)
    x['Fila'] = x['Fila'].astype(float)
    x['Dependencias'] = x['Dependencias'].astype(float)
    x['Ordem'] = x['Ordem'].astype(float)
    x['Disponibilidade'] = x['Disponibilidade'].astype(float)

    return x


def generate_plotly_dashboard(df, output_path='dashboard_voth.html'):
    import plotly.express as px
    import plotly.graph_objects as go

    fig1 = px.bar(df.sort_values('BottleneckScore', ascending=False),
                  x='Posto', y='BottleneckScore', color='Impacto', title='Ranking de Gargalos por BottleneckScore')

    fig2 = px.scatter(df, x='Tempo', y='Fila', color='Impacto', size='Dependencias', hover_data=['Posto'],
                      title='Tempo vs Fila (clusters de gargalos)')

    fig3 = px.bar(df, x='Posto', y='Disponibilidade', color='Impacto', title='Disponibilidade por Posto')

    features = ['Tempo', 'Fila', 'Dependencias', 'Ordem', 'Disponibilidade']
    _, feat_imp = random_forest_importance(df)
    feat_df = pd.DataFrame(feat_imp, columns=['Feature', 'Importance'])
    fig4 = px.bar(feat_df, x='Feature', y='Importance', title='Importância de Features (Random Forest)')

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('<h1>Dashboard de Gargalos - VOTH</h1>')
        f.write('<h2>Tabela resumida</h2>')
        f.write(df.to_html(index=False))
        f.write('<h2>Gráficos</h2>')
        f.write(fig1.to_html(full_html=False, include_plotlyjs='cdn'))
        f.write(fig2.to_html(full_html=False, include_plotlyjs=False))
        f.write(fig3.to_html(full_html=False, include_plotlyjs=False))
        f.write(fig4.to_html(full_html=False, include_plotlyjs=False))

    print(f"Dashboard gerado em: {output_path}")


def read_input(path):
    if path.endswith('.csv'):
        return pd.read_csv(path)
    if path.endswith('.xlsx') or path.endswith('.xls'):
        return pd.read_excel(path)
    raise ValueError('Formato de arquivo não suportado. Use .csv ou .xlsx')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        source = sys.argv[1]
        raw_df = read_input(source)
    else:
        raw_df = pd.DataFrame([
            {'Posto':'A', 'Tempo':10, 'Fila':12, 'Dependencias':4, 'Ordem':1, 'Disponibilidade':0.85},
            {'Posto':'B', 'Tempo':18, 'Fila':20, 'Dependencias':3, 'Ordem':2, 'Disponibilidade':0.70},
            {'Posto':'C', 'Tempo':7, 'Fila':8, 'Dependencias':2, 'Ordem':3, 'Disponibilidade':0.92},
            {'Posto':'D', 'Tempo':25, 'Fila':28, 'Dependencias':5, 'Ordem':4, 'Disponibilidade':0.65},
            {'Posto':'E', 'Tempo':16, 'Fila':10, 'Dependencias':1, 'Ordem':5, 'Disponibilidade':0.78}
        ])

    processed_df = prepare_dataframe(raw_df)
    processed_df = compute_bottleneck_score(processed_df)
    show_report(processed_df, show_extra=False)
    generate_plotly_dashboard(processed_df, output_path='dashboard_voth.html')
